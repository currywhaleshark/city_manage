// Adapted from SaintPepsi/traffic-microsim, MIT, Copyright (c) 2026 Ian Hogers.
export interface Driver {
  maxAccel: number;
  comfortBrake: number;
  safetyGap: number;
  headway: number;
}
export function desiredGap(p: Driver, speed: number, closingSpeed: number) {
  return (
    p.safetyGap +
    Math.max(
      0,
      speed * p.headway +
        (speed * closingSpeed) / (2 * Math.sqrt(p.maxAccel * p.comfortBrake)),
    )
  );
}
export function idmAccel(
  p: Driver,
  speed: number,
  gap: number,
  closingSpeed: number,
  targetSpeed: number,
) {
  const free = 1 - Math.pow(speed / Math.max(0.1, targetSpeed), 4);
  const interaction = Math.pow(
    desiredGap(p, speed, closingSpeed) / Math.max(gap, 0.1),
    2,
  );
  return p.maxAccel * (free - interaction);
}
