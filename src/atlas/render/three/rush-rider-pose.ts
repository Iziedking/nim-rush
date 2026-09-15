export type RiderPoint = [number, number, number];
export const CRANK_RADIUS = .17;
export const UPPER_LEG_LENGTH = .47;
export const LOWER_LEG_LENGTH = .47;

export function pedalPoint(angle: number, side: number): RiderPoint {
  const phase = angle + side * Math.PI;
  return [side === 0 ? -.23 : .23, .42 - Math.sin(phase) * CRANK_RADIUS, -.06 + Math.cos(phase) * CRANK_RADIUS];
}

// Analytic two-bone IK keeps the knee connected without stretching the thigh
// or shin as the opposite pedals travel through their crank circle.
export function riderKnee(hip: RiderPoint, ankle: RiderPoint, side: number): RiderPoint {
  const delta = ankle.map((v, i) => v - hip[i]!) as RiderPoint;
  const length = Math.hypot(...delta);
  const direction = delta.map(v => v / Math.max(.00001, length)) as RiderPoint;
  const reach = Math.min(UPPER_LEG_LENGTH + LOWER_LEG_LENGTH - .00001, length);
  const along = (UPPER_LEG_LENGTH ** 2 - LOWER_LEG_LENGTH ** 2 + reach ** 2) / (2 * Math.max(.00001, reach));
  const bend = Math.sqrt(Math.max(0, UPPER_LEG_LENGTH ** 2 - along ** 2));
  const hint = [side === 0 ? -.14 : .14, 0, 1];
  const dot = hint.reduce((sum, v, i) => sum + v * direction[i]!, 0);
  const normal = hint.map((v, i) => v - direction[i]! * dot);
  const norm = Math.hypot(...normal);
  return hip.map((v, i) => v + direction[i]! * along + normal[i]! / Math.max(.00001, norm) * bend) as RiderPoint;
}
