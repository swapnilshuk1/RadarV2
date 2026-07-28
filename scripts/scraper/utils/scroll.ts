import type { Page } from "playwright";
import { jitter } from "./jitter";

export interface HydrateOptions {
  /** CSS selector matching individual card items */
  cardSelector: string;
  /** Primary and fallback CSS selectors for the scrollable container */
  containerSelectors: string[];
  /** Target number of cards to discover before stopping (e.g. 25) */
  targetCards: number;
  /** Maximum scroll attempts before stopping (default: 6) */
  maxPasses?: number;
  /** Number of consecutive scroll passes with 0 new cards to declare DOM stability (default: 2) */
  consecutiveStableLimit?: number;
}

export interface HydrationResult {
  initialCount: number;
  finalCount: number;
  passesCompleted: number;
  stabilized: boolean;
}

/**
 * Generalized virtualized list scroll hydrator.
 * Scrolls the designated container (or page) incrementally until card count stabilizes
 * or target card count is satisfied.
 */
export async function hydrateVirtualizedList(
  page: Page,
  options: HydrateOptions,
  logger?: (msg: string) => void
): Promise<HydrationResult> {
  const {
    cardSelector,
    containerSelectors,
    targetCards,
    maxPasses = 6,
    consecutiveStableLimit = 2,
  } = options;

  const log = logger || (() => {});

  // 1. Initial count check
  let currentCards = await page.locator(cardSelector).count().catch(() => 0);
  const initialCount = currentCards;

  log(`[Hydration] Initial DOM card count: ${initialCount} (target: ${targetCards})`);

  // Fast path: Already satisfied
  if (currentCards >= targetCards) {
    log(`[Hydration] Target met on initial load (${currentCards} >= ${targetCards}). Skipping scroll.`);
    return {
      initialCount,
      finalCount: currentCards,
      passesCompleted: 0,
      stabilized: true,
    };
  }

  // Locate the scrollable container using fallback selectors
  let containerLocator = null;
  for (const selector of containerSelectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > 0) {
      containerLocator = page.locator(selector).first();
      log(`[Hydration] Identified scroll container using selector: "${selector}"`);
      break;
    }
  }

  let passesCompleted = 0;
  let consecutiveUnchanged = 0;
  let lastCount = currentCards;

  for (let pass = 1; pass <= maxPasses; pass++) {
    passesCompleted = pass;

    // Scroll action: scroll container if found, else scroll window
    if (containerLocator) {
      await containerLocator.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      }).catch(() => {});
    } else {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.8);
      }).catch(() => {});
    }

    // Jitter delay for DOM rendering & IntersectionObserver triggers
    await jitter(400, 800);

    // Re-count cards
    currentCards = await page.locator(cardSelector).count().catch(() => 0);
    log(`[Hydration] Pass ${pass}/${maxPasses}: ${lastCount} ➔ ${currentCards} cards`);

    // Check progress
    if (currentCards > lastCount) {
      consecutiveUnchanged = 0;
      lastCount = currentCards;
    } else {
      consecutiveUnchanged++;
      log(`[Hydration] No new cards discovered (stable pass ${consecutiveUnchanged}/${consecutiveStableLimit})`);
    }

    // Stop conditions
    if (currentCards >= targetCards) {
      log(`[Hydration] Target card count reached (${currentCards} >= ${targetCards}). Stopping.`);
      return { initialCount, finalCount: currentCards, passesCompleted, stabilized: true };
    }

    if (consecutiveUnchanged >= consecutiveStableLimit) {
      log(`[Hydration] DOM card count stabilized at ${currentCards} cards across ${consecutiveStableLimit} passes. Stopping.`);
      return { initialCount, finalCount: currentCards, passesCompleted, stabilized: true };
    }
  }

  log(`[Hydration] Max scroll passes (${maxPasses}) reached. Final card count: ${currentCards}`);
  return { initialCount, finalCount: currentCards, passesCompleted, stabilized: false };
}
