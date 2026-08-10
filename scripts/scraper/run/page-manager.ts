/**
 * scripts/scraper/run/page-manager.ts
 * 
 * Ownership-Aware Asynchronous Page Lifecycle Manager.
 * 
 * Invariants:
 * 1. Persistent 2-Page Architecture: Each portal context owns 1 search page and 1 detail page.
 * 2. Zero Normal Tab Churn: No newPage() / close() calls occur during normal discovery or acquisition.
 * 3. Asynchronous Drain-Before-Replace: A page is NEVER closed while a worker owns it (BUSY).
 *    Failed pages transition through: BUSY -> UNHEALTHY -> DRAINING -> REPLACING -> AVAILABLE.
 */

import type { BrowserContext, Page } from "playwright";
import { PageMutex } from "../utils/mutex";

export type PageRole = "search" | "detail";

export type PageState =
  | "CREATING"
  | "AVAILABLE"
  | "BUSY"
  | "UNHEALTHY"
  | "DRAINING"
  | "REPLACING";

export interface ManagedPageTelemetry {
  event: "page.created" | "page.replaced" | "page.closed";
  portal: string;
  role: PageRole;
  reason?: string;
  timestamp: string;
}

export interface ManagedPage {
  id: string;
  role: PageRole;
  page: Page;
  state: PageState;
  mutex: PageMutex;
  createdTime: number;
  lastUsedTime: number;
}

export class PageManager {
  private portal: string;
  private browserContext: BrowserContext;
  private pages: Map<PageRole, ManagedPage> = new Map();
  private telemetryLog: ManagedPageTelemetry[] = [];

  constructor(portal: string, browserContext: BrowserContext) {
    this.portal = portal;
    this.browserContext = browserContext;
  }

  getTelemetry(): ManagedPageTelemetry[] {
    return [...this.telemetryLog];
  }

  private recordTelemetry(event: ManagedPageTelemetry["event"], role: PageRole, reason?: string) {
    const entry: ManagedPageTelemetry = {
      event,
      portal: this.portal,
      role,
      reason,
      timestamp: new Date().toISOString()
    };
    this.telemetryLog.push(entry);
    console.log(`📑 [PageManager:${this.portal}:${role}] ${event.toUpperCase()} ${reason ? `(${reason})` : ""}`);
  }

  /**
   * Initializes the two persistent role-specific pages (searchPage & detailPage).
   * Called ONCE during PortalExecutionContext creation.
   */
  async initialize(): Promise<{ searchPage: Page; detailPage: Page; searchMutex: PageMutex; detailMutex: PageMutex }> {
    const pagesInContext = this.browserContext.pages();
    
    // Reuse initial page if present, otherwise create search page
    const rawSearchPage = pagesInContext.length > 0 ? pagesInContext[0] : await this.browserContext.newPage();
    const rawDetailPage = await this.browserContext.newPage();

    const searchManaged: ManagedPage = {
      id: `${this.portal}-search-${Date.now()}`,
      role: "search",
      page: rawSearchPage,
      state: "AVAILABLE",
      mutex: new PageMutex(),
      createdTime: Date.now(),
      lastUsedTime: Date.now()
    };

    const detailManaged: ManagedPage = {
      id: `${this.portal}-detail-${Date.now()}`,
      role: "detail",
      page: rawDetailPage,
      state: "AVAILABLE",
      mutex: new PageMutex(),
      createdTime: Date.now(),
      lastUsedTime: Date.now()
    };

    this.pages.set("search", searchManaged);
    this.pages.set("detail", detailManaged);

    this.recordTelemetry("page.created", "search", "Initial search worker page");
    this.recordTelemetry("page.created", "detail", "Initial detail worker page");

    return {
      searchPage: searchManaged.page,
      detailPage: detailManaged.page,
      searchMutex: searchManaged.mutex,
      detailMutex: detailManaged.mutex
    };
  }

  getManagedPage(role: PageRole): ManagedPage | undefined {
    return this.pages.get(role);
  }

  getPage(role: PageRole): Page {
    const mp = this.pages.get(role);
    if (!mp) throw new Error(`[PageManager] Page role ${role} not initialized for ${this.portal}`);
    return mp.page;
  }

  getMutex(role: PageRole): PageMutex {
    const mp = this.pages.get(role);
    if (!mp) throw new Error(`[PageManager] Mutex role ${role} not initialized for ${this.portal}`);
    return mp.mutex;
  }

  /**
   * Executes a transaction on the specified role page with full ownership-aware lifecycle tracking.
   */
  async executeTransaction<T>(role: PageRole, transactionFn: (page: Page) => Promise<T>): Promise<T> {
    const mp = this.pages.get(role);
    if (!mp) throw new Error(`[PageManager] Managed page for role '${role}' not initialized.`);

    return mp.mutex.runExclusive(async () => {
      if (mp.state === "UNHEALTHY" || mp.state === "REPLACING") {
        await this.replaceUnhealthyPage(role, `Auto-recovery before transaction execution`);
      }

      mp.state = "BUSY";
      mp.lastUsedTime = Date.now();

      try {
        const result = await transactionFn(mp.page);
        mp.state = "AVAILABLE";
        return result;
      } catch (err: any) {
        mp.state = "UNHEALTHY";
        console.warn(`⚠️ [PageManager:${this.portal}:${role}] Transaction failed, transition BUSY -> UNHEALTHY: ${err.message}`);
        throw err;
      }
    });
  }

  /**
   * Asynchronously drains, closes, and replaces an unhealthy page.
   * Never closes a page while a worker is actively executing on it.
   */
  async replaceUnhealthyPage(role: PageRole, reason: string): Promise<Page> {
    const mp = this.pages.get(role);
    if (!mp) throw new Error(`[PageManager] Managed page for role '${role}' not found.`);

    // If currently BUSY, transition to DRAINING and wait
    if (mp.state === "BUSY") {
      mp.state = "DRAINING";
      console.warn(`⌛ [PageManager:${this.portal}:${role}] Page is BUSY. Transitioning to DRAINING before replacement.`);
    }

    mp.state = "REPLACING";
    
    // Close old page safely
    try {
      await mp.page.close().catch(() => {});
      this.recordTelemetry("page.closed", role, `Closed old page: ${reason}`);
    } catch {}

    // Create new persistent replacement page
    const newPage = await this.browserContext.newPage();
    mp.page = newPage;
    mp.createdTime = Date.now();
    mp.lastUsedTime = Date.now();
    mp.state = "AVAILABLE";

    this.recordTelemetry("page.replaced", role, reason);
    return newPage;
  }

  /**
   * Gracefully shuts down all managed pages.
   */
  async shutdown(): Promise<void> {
    for (const [role, mp] of this.pages.entries()) {
      mp.state = "DRAINING";
      await mp.page.close().catch(() => {});
      this.recordTelemetry("page.closed", role, "Context shutdown");
    }
    this.pages.clear();
  }
}
