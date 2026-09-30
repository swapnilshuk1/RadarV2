export function profilePollDelay(ticks: number): number {
  return Math.min(1200 * Math.pow(1.5, Math.floor(Math.max(0, ticks) / 3)), 30_000);
}

export function shouldPollProfile(status: string | null, visible: boolean): boolean {
  return visible && status !== "COMPLETED" && status !== "FAILED";
}
