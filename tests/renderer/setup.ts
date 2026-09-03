// Vitest setup: installs a mock window.api before any renderer module loads
// (src/renderer/src/lib/api.ts captures window.api at import time). Runs for
// all suites; only takes effect in the jsdom environment.

import { installMockApi } from './mockApi'

if (typeof window !== 'undefined') {
  installMockApi()

  // jsdom lacks ResizeObserver; @tanstack/react-virtual sizes its viewport
  // from observer callbacks, so the stub must fire one synthetic measurement
  // per observe() or virtualized lists mount zero rows.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        const size = { inlineSize: 1024, blockSize: 768 }
        const entry = {
          target,
          borderBoxSize: [size],
          contentBoxSize: [size],
          contentRect: target.getBoundingClientRect(),
          devicePixelContentBoxSize: [size]
        } as unknown as ResizeObserverEntry
        queueMicrotask(() => this.callback([entry], this as unknown as ResizeObserver))
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  }
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {}
  }

  // jsdom has no layout: every element measures 0×0, so virtualized lists
  // would mount zero rows. Report a fixed viewport-sized rect instead.
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({})
    } as DOMRect
  }
}
