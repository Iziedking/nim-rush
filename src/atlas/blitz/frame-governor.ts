export class BlitzFrameGovernor {
  private readonly intervalMs: number;
  private nextRenderAt: number | null = null;

  constructor(targetFps: number) {
    if (!Number.isFinite(targetFps) || targetFps <= 0) throw new Error('Target FPS must be positive.');
    this.intervalMs = 1_000 / targetFps;
  }

  shouldRender(timestamp: number): boolean {
    if (this.nextRenderAt === null || timestamp + this.intervalMs < this.nextRenderAt) {
      this.nextRenderAt = timestamp + this.intervalMs;
      return true;
    }
    if (timestamp + 0.5 < this.nextRenderAt) return false;
    while (this.nextRenderAt <= timestamp + 0.5) this.nextRenderAt += this.intervalMs;
    return true;
  }

  reset(): void {
    this.nextRenderAt = null;
  }
}
