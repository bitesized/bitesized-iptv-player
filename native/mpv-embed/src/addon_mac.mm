// In-process libmpv embedding for macOS via the libmpv RENDER API.
//
// Why the render API (and not `--wid`): handing libmpv an NSView via `wid`
// works, but mpv's macOS backend renders the video at its *native* resolution
// into that view and never scales it to the container — so a 640x480 stream
// sits in a corner of a 1440x900 window (verified: view-resize, scaling props,
// and window-resize all fail to make it fill). The render API fixes this: mpv
// draws into an OpenGL framebuffer *we* own and size to the view, so the video
// always fills whatever size the app is scaled to. We create an NSOpenGLView,
// place it below the transparent web layer, create an mpv_render_context bound
// to that GL context, and render on mpv's update callback.
//
// The addon speaks the *same event shape* the JSON-IPC transport does
// (`{event, id, name, data}` / `file-loaded` / `end-file`), serialized to JSON
// strings, so the JS side reuses the existing mpv event mapping unchanged.

#import <Cocoa/Cocoa.h>
#import <OpenGL/gl.h>
#include <CoreFoundation/CoreFoundation.h>
#include <node_api.h>
#include <mpv/client.h>
#include <mpv/render_gl.h>

#include <atomic>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

// --- OpenGL symbol lookup for mpv's render API ----------------------------

static void *mpvGetProcAddress(void * /*ctx*/, const char *name) {
  static CFBundleRef bundle = CFBundleGetBundleWithIdentifier(CFSTR("com.apple.opengl"));
  if (!bundle) return nullptr;
  CFStringRef sym = CFStringCreateWithCString(kCFAllocatorDefault, name, kCFStringEncodingASCII);
  void *addr = CFBundleGetFunctionPointerForName(bundle, sym);
  CFRelease(sym);
  return addr;
}

// --- The GL view mpv renders into -----------------------------------------

@interface MpvGLView : NSOpenGLView
// Cleared before the render context is freed so a late render() is a no-op.
@property(nonatomic, assign) mpv_render_context *renderCtx;
- (void)render;
@end

@implementation MpvGLView

- (instancetype)initWithFrame:(NSRect)frame {
  NSOpenGLPixelFormatAttribute attrs[] = {
      NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core,
      NSOpenGLPFAAccelerated,
      NSOpenGLPFADoubleBuffer,
      NSOpenGLPFAAllowOfflineRenderers,
      0};
  NSOpenGLPixelFormat *pf = [[NSOpenGLPixelFormat alloc] initWithAttributes:attrs];
  self = [super initWithFrame:frame pixelFormat:pf];
  if (self) {
    // Retina: render at the backing (pixel) resolution, not points.
    self.wantsBestResolutionOpenGLSurface = YES;
  }
  return self;
}

- (void)prepareOpenGL {
  [super prepareOpenGL];
  GLint swap = 1;  // vsync
  [[self openGLContext] setValues:&swap forParameter:NSOpenGLContextParameterSwapInterval];
}

// Render one frame at the view's current backing size, so mpv scales the video
// to fill the view. Runs on the main thread only.
- (void)render {
  NSOpenGLContext *ctx = [self openGLContext];
  if (!self.renderCtx || !ctx) return;
  [ctx makeCurrentContext];
  CGLLockContext(ctx.CGLContextObj);
  NSSize px = [self convertSizeToBacking:self.bounds.size];
  mpv_opengl_fbo fbo;
  fbo.fbo = 0;  // the view's default framebuffer
  fbo.w = static_cast<int>(px.width);
  fbo.h = static_cast<int>(px.height);
  fbo.internal_format = 0;
  int flip = 1;
  // block_for_target_time = 0: never let mpv block THIS (the main) thread waiting
  // for a frame's presentation time — that stalls Chromium input/paint and, with
  // a per-frame render queue, snowballs into seconds of control lag. We present
  // immediately and report the swap so mpv paces itself (advanced control).
  int blockForTargetTime = 0;
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
      {MPV_RENDER_PARAM_FLIP_Y, &flip},
      {MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &blockForTargetTime},
      {static_cast<mpv_render_param_type>(0), nullptr}};
  mpv_render_context_render(self.renderCtx, params);
  [ctx flushBuffer];
  CGLUnlockContext(ctx.CGLContextObj);
  // Report the presentation so mpv (with ADVANCED_CONTROL) paces to the display
  // and doesn't over-produce update callbacks.
  mpv_render_context_report_swap(self.renderCtx);
}

// System-driven redraws (resize, expose) also render the current frame.
- (void)drawRect:(NSRect)dirtyRect {
  (void)dirtyRect;
  [self render];
}

@end

// At most one render may be queued on the main thread at a time. Without this,
// mpv posts a block per frame (25-60/s); if the main thread ever falls behind,
// the queue fills with render blocks and everything else the main thread must
// do — Chromium input handling, React re-renders — waits behind them, so the
// on-screen controls lag by seconds (each render also blocks on vsync). See
// TODO 7.5 #5b follow-up.
static std::atomic<bool> g_renderScheduled{false};

// mpv signals "a new frame is ready" from its render thread; hop to the main
// thread (where the GL context lives) to actually draw. The block retains the
// view; render() bails if the context has since been torn down.
static void onMpvRenderUpdate(void *ctx) {
  if (g_renderScheduled.exchange(true)) return;  // one already queued — coalesce
  MpvGLView *view = (__bridge MpvGLView *)ctx;
  dispatch_async(dispatch_get_main_queue(), ^{
    // Clear before rendering so a frame arriving mid-render queues the next one.
    g_renderScheduled.store(false);
    [view render];
  });
}

namespace {

mpv_handle *g_mpv = nullptr;
mpv_render_context *g_render = nullptr;
MpvGLView *g_view = nil;
napi_threadsafe_function g_tsfn = nullptr;
std::thread g_eventThread;
std::atomic<bool> g_running{false};

// --- helpers --------------------------------------------------------------

std::string jsonEscape(const char *s) {
  std::string out;
  if (!s) return out;
  for (const char *p = s; *p; ++p) {
    unsigned char c = static_cast<unsigned char>(*p);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

// Serialize an mpv_node to JSON. Covers the formats our observed properties use
// (scalars, plus track-list = array of maps of scalars).
void nodeToJson(const mpv_node *node, std::ostringstream &os) {
  switch (node->format) {
    case MPV_FORMAT_STRING:
      os << '"' << jsonEscape(node->u.string) << '"';
      break;
    case MPV_FORMAT_FLAG:
      os << (node->u.flag ? "true" : "false");
      break;
    case MPV_FORMAT_INT64:
      os << node->u.int64;
      break;
    case MPV_FORMAT_DOUBLE:
      os << node->u.double_;
      break;
    case MPV_FORMAT_NODE_ARRAY: {
      os << '[';
      for (int i = 0; i < node->u.list->num; ++i) {
        if (i) os << ',';
        nodeToJson(&node->u.list->values[i], os);
      }
      os << ']';
      break;
    }
    case MPV_FORMAT_NODE_MAP: {
      os << '{';
      for (int i = 0; i < node->u.list->num; ++i) {
        if (i) os << ',';
        os << '"' << jsonEscape(node->u.list->keys[i]) << "\":";
        nodeToJson(&node->u.list->values[i], os);
      }
      os << '}';
      break;
    }
    default:
      os << "null";
  }
}

std::string serializeEvent(mpv_event *ev) {
  switch (ev->event_id) {
    case MPV_EVENT_PROPERTY_CHANGE: {
      auto *prop = static_cast<mpv_event_property *>(ev->data);
      std::ostringstream os;
      os << "{\"event\":\"property-change\",\"id\":" << ev->reply_userdata
         << ",\"name\":\"" << jsonEscape(prop->name) << "\",\"data\":";
      if (prop->format == MPV_FORMAT_NODE && prop->data) {
        nodeToJson(static_cast<mpv_node *>(prop->data), os);
      } else {
        os << "null";
      }
      os << '}';
      return os.str();
    }
    case MPV_EVENT_FILE_LOADED:
      return "{\"event\":\"file-loaded\"}";
    case MPV_EVENT_END_FILE: {
      auto *ef = static_cast<mpv_event_end_file *>(ev->data);
      const char *reason = "eof";
      if (ef->reason == MPV_END_FILE_REASON_ERROR) reason = "error";
      else if (ef->reason == MPV_END_FILE_REASON_STOP) reason = "stop";
      else if (ef->reason == MPV_END_FILE_REASON_QUIT) reason = "quit";
      std::ostringstream os;
      os << "{\"event\":\"end-file\",\"reason\":\"" << reason << "\"}";
      return os.str();
    }
    default:
      return "";
  }
}

// Runs on the JS/main thread: deliver one JSON event string to the JS sink.
void callJs(napi_env env, napi_value jsCallback, void * /*context*/, void *data) {
  auto *json = static_cast<std::string *>(data);
  if (env && jsCallback) {
    napi_value str;
    napi_create_string_utf8(env, json->c_str(), json->size(), &str);
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, jsCallback, 1, &str, nullptr);
  }
  delete json;
}

void eventLoop() {
  while (g_running.load()) {
    mpv_event *ev = mpv_wait_event(g_mpv, 0.05);
    if (!ev || ev->event_id == MPV_EVENT_NONE) continue;
    if (ev->event_id == MPV_EVENT_SHUTDOWN) break;
    std::string payload = serializeEvent(ev);
    if (payload.empty()) continue;
    if (g_tsfn) {
      napi_call_threadsafe_function(g_tsfn, new std::string(std::move(payload)),
                                    napi_tsfn_blocking);
    }
  }
}

// --- argument helpers -----------------------------------------------------

std::string getStringArg(napi_env env, napi_value v) {
  size_t len = 0;
  napi_get_value_string_utf8(env, v, nullptr, 0, &len);
  std::string s(len, '\0');
  napi_get_value_string_utf8(env, v, &s[0], len + 1, &len);
  return s;
}

void throwMpv(napi_env env, const char *what, int status) {
  std::ostringstream os;
  os << what << ": " << mpv_error_string(status);
  napi_throw_error(env, nullptr, os.str().c_str());
}

// --- exported functions ---------------------------------------------------

// create(nativeWindowHandle: Buffer, sink: (json: string) => void)
napi_value Create(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (g_mpv) {
    napi_throw_error(env, nullptr, "mpv embed already created");
    return nullptr;
  }

  // Electron's getNativeWindowHandle() returns a Buffer holding the NSView*.
  void *bufData = nullptr;
  size_t bufLen = 0;
  napi_get_buffer_info(env, args[0], &bufData, &bufLen);
  if (bufLen < sizeof(void *)) {
    napi_throw_error(env, nullptr, "invalid native window handle");
    return nullptr;
  }
  NSView *parent = (__bridge NSView *)(*reinterpret_cast<void **>(bufData));

  g_mpv = mpv_create();
  if (!g_mpv) {
    napi_throw_error(env, nullptr, "mpv_create failed");
    return nullptr;
  }

  // Mirror the spawn path's hardened args.
  // vo=libmpv is REQUIRED for the render API (we own the GL output).
  auto opt = [](const char *k, const char *v) { mpv_set_option_string(g_mpv, k, v); };
  opt("vo", "libmpv");
  opt("config", "no");
  opt("osc", "no");
  opt("osd-bar", "no");
  opt("input-default-bindings", "no");
  opt("input-vo-keyboard", "no");
  opt("keep-open", "yes");
  opt("hwdec", "auto-safe");
  opt("cache", "yes");
  opt("cache-secs", "30");
  opt("demuxer-max-bytes", "64MiB");
  opt("stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_delay_max=5");
  opt("user-agent", "IPTVPlayer/0.1");

  int rc = mpv_initialize(g_mpv);
  if (rc < 0) {
    mpv_destroy(g_mpv);
    g_mpv = nullptr;
    throwMpv(env, "mpv_initialize", rc);
    return nullptr;
  }

  // Create the GL video view and add it *below* the web layer so the
  // transparent React controls overlay it. This runs on Electron's main thread
  // (== the Cocoa main thread), so we touch AppKit directly.
  g_view = [[MpvGLView alloc] initWithFrame:parent.bounds];
  g_view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [parent addSubview:g_view positioned:NSWindowBelow relativeTo:nil];

  // Bind an mpv render context to this view's GL context. Must be current.
  [[g_view openGLContext] makeCurrentContext];
  mpv_opengl_init_params glInit;
  glInit.get_proc_address = mpvGetProcAddress;
  glInit.get_proc_address_ctx = nullptr;
  int advanced = 1;
  mpv_render_param rparams[] = {
      {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
      {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced},
      {static_cast<mpv_render_param_type>(0), nullptr}};
  rc = mpv_render_context_create(&g_render, g_mpv, rparams);
  if (rc < 0) {
    mpv_terminate_destroy(g_mpv);
    g_mpv = nullptr;
    [g_view removeFromSuperview];
    g_view = nil;
    throwMpv(env, "mpv_render_context_create", rc);
    return nullptr;
  }
  g_view.renderCtx = g_render;
  // Start each session with no render queued, so a stale flag from a prior
  // create/destroy can never suppress the first frame.
  g_renderScheduled.store(false);
  mpv_render_context_set_update_callback(g_render, onMpvRenderUpdate,
                                         (__bridge void *)g_view);

  // Threadsafe function bridging the mpv event thread → JS sink.
  napi_value resourceName;
  napi_create_string_utf8(env, "mpv-embed-events", NAPI_AUTO_LENGTH, &resourceName);
  napi_create_threadsafe_function(env, args[1], nullptr, resourceName, 0, 1, nullptr,
                                  nullptr, nullptr, callJs, &g_tsfn);

  g_running = true;
  g_eventThread = std::thread(eventLoop);
  return nullptr;
}

// command(args: string[])
napi_value Command(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (!g_mpv) return nullptr;

  uint32_t len = 0;
  napi_get_array_length(env, args[0], &len);
  std::vector<std::string> strs;
  strs.reserve(len);
  for (uint32_t i = 0; i < len; ++i) {
    napi_value el;
    napi_get_element(env, args[0], i, &el);
    strs.push_back(getStringArg(env, el));
  }
  std::vector<const char *> cargs;
  cargs.reserve(len + 1);
  for (auto &s : strs) cargs.push_back(s.c_str());
  cargs.push_back(nullptr);

  int rc = mpv_command(g_mpv, cargs.data());
  if (rc < 0) {
    throwMpv(env, "mpv_command", rc);
  }
  return nullptr;
}

// setProperty(name: string, value: string)
napi_value SetProperty(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (!g_mpv) return nullptr;
  std::string name = getStringArg(env, args[0]);
  std::string value = getStringArg(env, args[1]);
  int rc = mpv_set_property_string(g_mpv, name.c_str(), value.c_str());
  if (rc < 0) throwMpv(env, "mpv_set_property", rc);
  return nullptr;
}

// observe(id: number, name: string)  — observed as NODE for uniform JSON
napi_value Observe(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (!g_mpv) return nullptr;
  int64_t id = 0;
  napi_get_value_int64(env, args[0], &id);
  std::string name = getStringArg(env, args[1]);
  mpv_observe_property(g_mpv, static_cast<uint64_t>(id), name.c_str(), MPV_FORMAT_NODE);
  return nullptr;
}

// setBounds(x, y, width, height) — keep the video view aligned to the DOM.
napi_value SetBounds(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  double x, y, w, h;
  napi_get_value_double(env, args[0], &x);
  napi_get_value_double(env, args[1], &y);
  napi_get_value_double(env, args[2], &w);
  napi_get_value_double(env, args[3], &h);
  // Called from the main thread; resize the view (autoresize also handles
  // window resizes) and redraw at the new size.
  if (g_view) {
    g_view.frame = NSMakeRect(x, y, w, h);
    [[g_view openGLContext] update];
    [g_view render];
  }
  return nullptr;
}

// reassertZOrder() — re-pin the video view *below* the web layer. macOS
// fullscreen transitions can reparent/reorder the contentView's subviews; the
// web contents view must stay on top so the DOM controls remain visible and
// clickable. Re-adding an existing subview just repositions it (no duplicate).
napi_value ReassertZOrder(napi_env /*env*/, napi_callback_info /*info*/) {
  if (g_view) {
    NSView *parent = g_view.superview;
    if (parent) {
      [g_view removeFromSuperview];
      g_view.frame = parent.bounds;
      g_view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [parent addSubview:g_view positioned:NSWindowBelow relativeTo:nil];
      [[g_view openGLContext] update];
      [g_view render];
    }
  }
  return nullptr;
}

napi_value Destroy(napi_env env, napi_callback_info /*info*/) {
  // Stop the event loop and unblock/join it.
  g_running = false;
  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_abort);
    g_tsfn = nullptr;
  }
  if (g_eventThread.joinable()) g_eventThread.join();

  // Tear down the render context first (mpv API requires it before destroying
  // the handle). Clear the view's pointer so a queued render() is a no-op, drop
  // the update callback, then free with the GL context current (main thread).
  mpv_render_context *render = g_render;
  g_render = nullptr;
  MpvGLView *view = g_view;
  g_view = nil;
  if (view) view.renderCtx = nullptr;
  if (render) {
    mpv_render_context_set_update_callback(render, nullptr, nullptr);
    [[view openGLContext] makeCurrentContext];
    mpv_render_context_free(render);
  }

  // Destroy mpv off the main thread so it can never block the run loop, then
  // remove our view once mpv is gone (kept alive by the block capture).
  mpv_handle *mpv = g_mpv;
  g_mpv = nullptr;
  if (mpv || view) {
    std::thread([mpv, view] {
      if (mpv) mpv_terminate_destroy(mpv);
      if (view) {
        dispatch_async(dispatch_get_main_queue(), ^{
          [view removeFromSuperview];
        });
      }
    }).detach();
  }
  return nullptr;
}

napi_value ApiVersion(napi_env env, napi_callback_info /*info*/) {
  napi_value result;
  napi_create_uint32(env, static_cast<uint32_t>(mpv_client_api_version()), &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  auto def = [&](const char *name, napi_callback fn) {
    napi_value v;
    napi_create_function(env, name, NAPI_AUTO_LENGTH, fn, nullptr, &v);
    napi_set_named_property(env, exports, name, v);
  };
  def("apiVersion", ApiVersion);
  def("create", Create);
  def("command", Command);
  def("setProperty", SetProperty);
  def("observe", Observe);
  def("setBounds", SetBounds);
  def("reassertZOrder", ReassertZOrder);
  def("destroy", Destroy);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
