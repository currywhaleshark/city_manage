export type DisplayQuality = "normal" | "light";

export const DISPLAY_PRESETS = {
  normal: { pixelRatio: 1.5, shadows: true, maxFPS: 60 },
  light: { pixelRatio: 1, shadows: false, maxFPS: 30 },
} as const;

const STORAGE_KEY = "mayor-display-quality";

export function readDisplayQuality(): DisplayQuality {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "normal";
  } catch {
    return "normal";
  }
}

export function saveDisplayQuality(quality: DisplayQuality) {
  try {
    localStorage.setItem(STORAGE_KEY, quality);
  } catch {
    // Private/embedded browsers may deny storage; the current choice still works.
  }
}

export class RenderClock {
  private nextAt = 0;
  private quality?: DisplayQuality;

  due(now: number, quality: DisplayQuality) {
    const interval = 1000 / DISPLAY_PRESETS[quality].maxFPS;
    if (quality !== this.quality) {
      this.quality = quality;
      this.nextAt = now;
    }
    if (now + 0.5 < this.nextAt) return false;
    // Carry fractional refresh intervals forward (e.g. a 144 Hz monitor).
    // After a long pause, discard missed renders instead of drawing a burst.
    this.nextAt += interval;
    if (this.nextAt < now - 0.5) this.nextAt = now + interval;
    return true;
  }
}
