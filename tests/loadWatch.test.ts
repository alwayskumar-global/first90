import { describe, expect, it, vi } from "vitest";
import { createLoadWatchdog, PHOTO_LOAD_TIMEOUT_MS } from "@/lib/images/loadWatch";

describe("photo load watchdog", () => {
  it("gives a photo 8 seconds, counted from when it is started, then times out once", () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const dog = createLoadWatchdog({ onTimeout });
      expect(PHOTO_LOAD_TIMEOUT_MS).toBe(8_000);
      vi.advanceTimersByTime(60_000);
      expect(onTimeout).not.toHaveBeenCalled(); // not started (not near the viewport): nothing is timed
      dog.start();
      vi.advanceTimersByTime(7_999);
      expect(onTimeout).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      dog.start();
      vi.advanceTimersByTime(60_000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starting again does not restart the clock", () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const dog = createLoadWatchdog({ onTimeout });
      dog.start();
      vi.advanceTimersByTime(5_000);
      dog.start();
      vi.advanceTimersByTime(3_000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a photo that loads or fails in time is never timed out afterwards", () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const dog = createLoadWatchdog({ onTimeout });
      dog.start();
      vi.advanceTimersByTime(2_000);
      dog.settle();
      vi.advanceTimersByTime(60_000);
      expect(onTimeout).not.toHaveBeenCalled();
      const early = createLoadWatchdog({ onTimeout });
      early.settle(); // settled before it was ever started
      early.start();
      vi.advanceTimersByTime(60_000);
      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the injected scheduler and cancels it on settle", () => {
    const schedule = vi.fn(() => "handle");
    const cancel = vi.fn();
    const dog = createLoadWatchdog({ timeoutMs: 1234, onTimeout: vi.fn(), schedule, cancel });
    dog.start();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 1234);
    dog.settle();
    expect(cancel).toHaveBeenCalledWith("handle");
  });
});
