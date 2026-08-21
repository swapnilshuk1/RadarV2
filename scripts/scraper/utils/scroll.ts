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
  /** Minimum delay in ms per scroll pass (default: 800) */
  minPassDelayMs?: number;
  /** Maximum delay in ms per scroll pass (default: 1500) */
  maxPassDelayMs?: number;
  /** Optional cancellation token check */
  isCancelled?: () => boolean;
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
    minPassDelayMs = 800,
    maxPassDelayMs = 1500,
    isCancelled,
  } = options;

  const log = logger || (() => {});

  if (isCancelled?.()) {
    return { initialCount: 0, finalCount: 0, passesCompleted: 0, stabilized: false };
  }

  // Helper to safely count cards without falsely reporting 0 on page close
  const safeCount = async (fallback: number) => {
    return await page.locator(cardSelector).count().catch(() => fallback);
  };

  // 1. Initial count check
  let currentCards = await safeCount(0);
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
    if (isCancelled?.()) {
      log(`[Hydration] Cancelled before pass ${pass}`);
      return { initialCount, finalCount: lastCount, passesCompleted, stabilized: false };
    }

    passesCompleted = pass;

    // 1. Target the last card element
    const cardsLocator = page.locator(cardSelector);
    const countBeforeScroll = await safeCount(lastCount);
    
    if (countBeforeScroll > 0) {
      const lastCard = cardsLocator.nth(countBeforeScroll - 1);
      
      // Hover on the last card to trigger any hover-based loading listeners
      await lastCard.hover().catch(() => {});
      
      // Scroll it into view
      await lastCard.scrollIntoViewIfNeeded().catch(() => {});

      // Use the mouse wheel to scroll over the last card - this is often more effective
      // than setting scrollTop directly as it triggers native "wheel" and "scroll" events.
      const box = await lastCard.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.wheel(0, 800);
      }
    }

    // 2. Fallback: synthetic scroll events on container and window
    if (containerLocator) {
      await containerLocator.evaluate((el) => {
        el.scrollTop += (el.clientHeight || 800);
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      }).catch(() => {});
    }

    await page.evaluate(() => {
      window.scrollBy(0, 800);
      window.dispatchEvent(new Event('scroll', { bubbles: true }));
    }).catch(() => {});

    if (isCancelled?.()) {
      log(`[Hydration] Cancelled during pass ${pass}`);
      return { initialCount, finalCount: lastCount, passesCompleted, stabilized: false };
    }

    // Configurable jitter delay to allow portal API to respond and DOM to hydrate
    await jitter(minPassDelayMs, maxPassDelayMs);

    if (isCancelled?.()) {
      log(`[Hydration] Cancelled after wait in pass ${pass}`);
      return { initialCount, finalCount: lastCount, passesCompleted, stabilized: false };
    }

    // Re-count cards
    currentCards = await safeCount(lastCount);
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
