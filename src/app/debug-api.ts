/**
 * Test hook (architecture §5): with `?debug=1` in the URL, the app exposes this on `window.__kasaflow` for the
 * Playwright suites. It is never exposed without the flag.
 */
export interface DebugApi {
  /** True once the first frame with the map and agents has rendered. */
  readonly ready: boolean;
  /** Draw calls in the last rendered frame (renderer.info.render.calls). */
  drawCalls(): number;
  /** Jumps the live sim to hh:mm IST today (or tomorrow if already past) and resolves once that frame is shown. */
  skipTo(hhmm: string): Promise<void>;
  /** Display ids of vehicles currently on the map, e.g. "AT-HSR-031". */
  vehicleIds(): string[];
  /** Screen position (CSS pixels from the canvas's top-left) of an object, or null if off screen. */
  screenPositionOf(displayId: string): { readonly x: number; readonly y: number } | null;
  /** Screen position of a ground point with no object within 30 px, or null. */
  emptyGroundPoint(): { readonly x: number; readonly y: number } | null;
  /** Display id of the selected object, or null. */
  selectedId(): string | null;
}

declare global {
  interface Window {
    __kasaflow?: DebugApi;
  }
}
