/**
 * Light for an hour of the day (0–24, fractional). Pure numbers so the
 * renderer can apply it without allocations and tests can check it.
 * Without a clock (scenario experiments) the renderer keeps the noon light.
 */
export interface Daylight {
  background: number;
  sky: number;
  ground: number;
  hemisphere: number;
  sunColor: number;
  sunIntensity: number;
  /** Sun (or moon) position relative to the city centre. */
  sun: { x: number; y: number; z: number };
}

const KEYS: readonly [number, Omit<Daylight, "sun">][] = [
  [0, { background: 0x1d2638, sky: 0x3b4a6b, ground: 0x1b2230, hemisphere: 0.9, sunColor: 0x9fb3d9, sunIntensity: 0.35 }],
  [5, { background: 0x27304a, sky: 0x4a567a, ground: 0x22283a, hemisphere: 1.0, sunColor: 0xa9b4d6, sunIntensity: 0.4 }],
  [6.5, { background: 0xf0c7a2, sky: 0xffd2a6, ground: 0x6d6a5a, hemisphere: 1.6, sunColor: 0xffb070, sunIntensity: 1.4 }],
  [9, { background: 0xe1e7dd, sky: 0xfffaf0, ground: 0x7f9678, hemisphere: 2.2, sunColor: 0xfff1d6, sunIntensity: 2.4 }],
  [12, { background: 0xe1e7dd, sky: 0xfffaf0, ground: 0x7f9678, hemisphere: 2.3, sunColor: 0xfff6df, sunIntensity: 2.6 }],
  [16, { background: 0xe6e3d6, sky: 0xfff4e2, ground: 0x7d8f72, hemisphere: 2.2, sunColor: 0xffe8c4, sunIntensity: 2.3 }],
  [18.5, { background: 0xe9b98e, sky: 0xffc08a, ground: 0x6b5e52, hemisphere: 1.5, sunColor: 0xff9a5a, sunIntensity: 1.3 }],
  [20, { background: 0x40486a, sky: 0x5a5f86, ground: 0x2a2a3a, hemisphere: 1.0, sunColor: 0xb0a8d0, sunIntensity: 0.5 }],
  [22, { background: 0x1d2638, sky: 0x3b4a6b, ground: 0x1b2230, hemisphere: 0.9, sunColor: 0x9fb3d9, sunIntensity: 0.35 }],
  [24, { background: 0x1d2638, sky: 0x3b4a6b, ground: 0x1b2230, hemisphere: 0.9, sunColor: 0x9fb3d9, sunIntensity: 0.35 }],
];
/** The light used without a clock: the original fixed noon setup. */
export const NOON: Daylight = { ...KEYS[4][1], sun: { x: -196, y: 350, z: 84 } };
/** The sun rises in the east and sets in the west; the moon stays put. */
const SUNRISE = 6;
const SUNSET = 19;

function mixColor(a: number, b: number, t: number) {
  const channel = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function daylight(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
  const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  const day = (h - SUNRISE) / (SUNSET - SUNRISE);
  const sun =
    day >= 0 && day <= 1
      ? {
          x: Math.cos(Math.PI * day) * 300,
          y: 60 + 290 * Math.sin(Math.PI * day),
          z: 84,
        }
      : { x: -150, y: 260, z: -120 };
  return {
    background: mixColor(a.background, b.background, t),
    sky: mixColor(a.sky, b.sky, t),
    ground: mixColor(a.ground, b.ground, t),
    hemisphere: a.hemisphere + (b.hemisphere - a.hemisphere) * t,
    sunColor: mixColor(a.sunColor, b.sunColor, t),
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t,
    sun,
  };
}
