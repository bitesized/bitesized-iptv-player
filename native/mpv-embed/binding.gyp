{
  "targets": [
    {
      "target_name": "mpv_embed",
      "conditions": [
        ["OS=='mac'", {
          "sources": [ "src/addon_mac.mm" ],
          "cflags": [ "<!@(pkg-config --cflags mpv)" ],
          "libraries": [ "<!@(pkg-config --libs mpv)" ],
          "xcode_settings": {
            "OTHER_CFLAGS": [ "<!@(pkg-config --cflags mpv)" ],
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "11.0"
          },
          "link_settings": {
            "libraries": [
              "$(SDKROOT)/System/Library/Frameworks/Cocoa.framework",
              "$(SDKROOT)/System/Library/Frameworks/QuartzCore.framework",
              "$(SDKROOT)/System/Library/Frameworks/OpenGL.framework"
            ]
          }
        }],
        ["OS!='mac'", {
          "sources": [ "src/addon_stub.cc" ]
        }]
      ]
    }
  ]
}
