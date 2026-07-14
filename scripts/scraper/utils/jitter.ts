import { CONFIG } from "../config";

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function jitter(min = CONFIG.minJitterMs, max = CONFIG.maxJitterMs): Promise<void> {
  await sleep(randInt(min, max));
}

// Human-like scroll + mouse noise to avoid trivial bot detection.
export async function humanize(page: any): Promise<void> {
  try {
    const steps = randInt(2, 5);
    for (let i = 0; i < steps; i++) {
      await page.mouse.move(randInt(100, 900), randInt(100, 600), { steps: randInt(3, 8) });
      await page.evaluate((y: number) => window.scrollBy(0, y), randInt(120, 480));
      await sleep(randInt(180, 520));
    }
  } catch {
    /* non-fatal — humanization is best-effort */
  }
}
