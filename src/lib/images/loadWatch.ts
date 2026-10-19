/**
 * Watchdog for a place photo that never finishes loading (CR-010). Some hosts simply stop answering: the browser fires
 * neither `load` nor `error`, so the card would show an empty box forever. `start()` is called once the photo is
 * near the viewport (a lazy image far below the fold has not begun loading, so it must not be timed yet);
 * if `settle()` has not been called within `timeoutMs`, `onTimeout` fires once. Framework-free so it is unit-tested.
 */
export interface LoadWatchdog {
  /** Begin timing. Later calls do nothing. */
  start(): void;
  /** The photo loaded or failed: stop timing for good. */
  settle(): void;
}

export const PHOTO_LOAD_TIMEOUT_MS = 8_000;

export function createLoadWatchdog(options: {
  timeoutMs?: number;
  onTimeout: () => void;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}): LoadWatchdog {
  const { timeoutMs = PHOTO_LOAD_TIMEOUT_MS, onTimeout, schedule = (cb, ms) => setTimeout(cb, ms), cancel = (h) => clearTimeout(h as ReturnType<typeof setTimeout>) } = options;
  let handle: unknown;
  let started = false;
  let settled = false;
  return {
    start() {
      if (started || settled) return;
      started = true;
      handle = schedule(() => {
        if (settled) return;
        settled = true;
        onTimeout();
      }, timeoutMs);
    },
    settle() {
      settled = true;
      if (started) cancel(handle);
    },
  };
}
