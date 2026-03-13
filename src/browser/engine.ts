import { chromium as chromiumExtra, firefox as firefoxExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Browser, Page, BrowserContext } from "playwright";

// Register stealth on Chromium (no-op on Firefox — stealth isn't needed there)
chromiumExtra.use(StealthPlugin());
import fs from "fs";
import os from "os";
import path from "path";

// Headed by default — headless is opt-in for CI/server use
const HEADLESS = process.env.SCOUT_HEADLESS === "true";
const VIEWPORT_WIDTH = parseInt(process.env.SCOUT_VIEWPORT_WIDTH ?? "1280");
const VIEWPORT_HEIGHT = parseInt(process.env.SCOUT_VIEWPORT_HEIGHT ?? "800");
const CDP_PORT = parseInt(process.env.SCOUT_CDP_PORT ?? "9229");
const PORT_FILE = path.join(os.homedir(), ".scout-browser.port");

// Browser selection: "chromium" (default) or "firefox"
const BROWSER_TYPE = (process.env.SCOUT_BROWSER ?? "chromium").toLowerCase();
// Persistent profile directory — cookies/sessions survive restarts
const PROFILE_DIR = process.env.SCOUT_PROFILE_DIR ?? "";

class BrowserEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private _activePage: Page | null = null;
  private _persistent = false;
  private logs: string[] = [];
  private blockedResources: string[] = [];

  /** Get collected console logs. */
  getLogs(): string[] {
    return this.logs;
  }

  /** Clear collected console logs. */
  clearLogs(): void {
    this.logs = [];
  }

  /** Set resource types to block (image, media, stylesheet, font, script) */
  async setBlockedResources(types: string[]): Promise<void> {
    this.blockedResources = types;
    if (this.context) {
      await this.context.unroute("**/*");
      if (types.length > 0) {
        await this.context.route("**/*", (route) => {
          if (types.includes(route.request().resourceType())) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }
    }
  }

  /** Returns the active context, reconnecting to or launching the browser as needed. */
  async getContext(): Promise<BrowserContext> {
    await this._ensureBrowser();
    return this.context!;
  }

  /** Returns the active page, reconnecting to or launching the browser as needed. */
  async getPage(): Promise<Page> {
    await this._ensureBrowser();

    // Reuse active page if still alive
    if (this._activePage && !this._activePage.isClosed()) {
      return this._activePage;
    }

    // Try to reuse first open page from existing context
    const pages = this.context!.pages();
    if (pages.length > 0) {
      this._activePage = pages[pages.length - 1];
      return this._activePage;
    }

    this._activePage = await this.context!.newPage();
    return this._activePage;
  }

  /** All open pages (tabs) in the current context. */
  async getPages(): Promise<Page[]> {
    await this._ensureBrowser();
    return this.context!.pages();
  }

  /** Switch active page to a specific index or URL match. */
  async switchPage(indexOrUrl: number | string): Promise<Page> {
    const pages = await this.getPages();
    let target: Page | undefined;

    if (typeof indexOrUrl === "number") {
      target = pages[indexOrUrl];
    } else {
      target = pages.find((p) => p.url().includes(indexOrUrl));
    }

    if (!target) {
      throw new Error(
        `No tab found for: ${indexOrUrl}. Open tabs: ${pages.map((p, i) => `[${i}] ${p.url()}`).join(", ")}`
      );
    }

    this._activePage = target;
    await target.bringToFront();
    return target;
  }

  /** Open a new tab and make it active. */
  async newPage(): Promise<Page> {
    await this._ensureBrowser();
    this._activePage = await this.context!.newPage();
    return this._activePage;
  }

  async close(): Promise<void> {
    if (this._persistent && this.context) {
      await this.context.close();
      this.context = null;
      this._activePage = null;
      this._persistent = false;
    } else if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this._activePage = null;
      this._clearPortFile();
    }
  }

  async restartContext(storageStatePath?: string): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    await this._ensureBrowser(storageStatePath);
  }

  private async _ensureBrowser(storageStatePath?: string): Promise<void> {
    // Persistent context: already running
    if (this._persistent && this.context && !storageStatePath) return;
    // Non-persistent: already connected
    if (!this._persistent && this.browser?.isConnected() && this.context && !storageStatePath) return;

    const browserType = BROWSER_TYPE === "firefox" ? firefoxExtra : chromiumExtra;

    // Persistent context mode — keeps cookies/sessions across restarts
    if (PROFILE_DIR && !storageStatePath) {
      const args = BROWSER_TYPE !== "firefox"
        ? ["--no-sandbox", "--disable-dev-shm-usage"]
        : [];
      this.context = await browserType.launchPersistentContext(PROFILE_DIR, {
        headless: HEADLESS,
        args,
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
      this._persistent = true;
      this.browser = null;
      this.context.on("page", (p) => this._setupPage(p));
      for (const p of this.context.pages()) this._setupPage(p);
      this.context.on("close", () => {
        this.context = null;
        this._activePage = null;
        this._persistent = false;
      });
      if (this.blockedResources.length > 0) {
        await this._applyBlockedResources();
      }
      console.error(`Scout: launched persistent ${BROWSER_TYPE} context at ${PROFILE_DIR}`);
      return;
    }

    // Non-persistent Chromium: try CDP reconnect to existing browser
    if (BROWSER_TYPE !== "firefox") {
    const existingPort = this._readPortFile();
    if (existingPort) {
      try {
        if (!this.browser?.isConnected()) {
          this.browser = await chromiumExtra.connectOverCDP(
            `http://localhost:${existingPort}`,
            { timeout: 3000 }
          );
        }
        
        // If we need a new context (e.g. for storage state), we might not be able to 
        // easily create one over CDP if it's already managed by another process.
        // But here we are the manager of our own process's context.
        if (!this.context || storageStatePath) {
          this.context = await this.browser!.newContext({
            viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
            storageState: storageStatePath,
          });
          this.context.on("page", (p) => this._setupPage(p));
          for (const p of this.context.pages()) this._setupPage(p);
          if (this.blockedResources.length > 0) {
            await this.context.route("**/*", (route) => {
              if (this.blockedResources.includes(route.request().resourceType())) {
                route.abort();
              } else {
                route.continue();
              }
            });
          }
          this._activePage = null; // Reset active page
        }
        
        console.error(`Scout: using browser on port ${existingPort} ${storageStatePath ? "with storage state" : ""}`);
        return;
      } catch {
        // Browser gone — fall through to launch
        this._clearPortFile();
      }
    }
    } // end CDP reconnect block

    // Launch a fresh browser
    const args = BROWSER_TYPE !== "firefox"
      ? ["--no-sandbox", "--disable-dev-shm-usage", `--remote-debugging-port=${CDP_PORT}`]
      : [];

    this.browser = await browserType.launch({ headless: HEADLESS, args });
    this.context = await this.browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      storageState: storageStatePath,
    });
    this.context.on("page", (p) => this._setupPage(p));
    if (this.blockedResources.length > 0) {
      await this._applyBlockedResources();
    }

    if (BROWSER_TYPE !== "firefox") {
      this._writePortFile(CDP_PORT);
    }
    console.error(`Scout: launched ${BROWSER_TYPE} browser${storageStatePath ? " with storage state" : ""}`);
    this.browser.on("disconnected", () => this._clearPortFile());
  }

  private async _applyBlockedResources(): Promise<void> {
    if (!this.context) return;
    await this.context.route("**/*", (route) => {
      if (this.blockedResources.includes(route.request().resourceType())) {
        route.abort();
      } else {
        route.continue();
      }
    });
  }

  private _setupPage(page: Page): void {
    page.on("console", (msg) => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      this.logs.push(entry);
      if (this.logs.length > 100) this.logs.shift();
    });
    page.on("pageerror", (err) => {
      this.logs.push(`[error] ${err.message}`);
      if (this.logs.length > 100) this.logs.shift();
    });
  }

  private _readPortFile(): number | null {
    try {
      const val = fs.readFileSync(PORT_FILE, "utf8").trim();
      const port = parseInt(val);
      return isNaN(port) ? null : port;
    } catch {
      return null;
    }
  }

  private _writePortFile(port: number): void {
    try {
      fs.writeFileSync(PORT_FILE, String(port));
    } catch {}
  }

  private _clearPortFile(): void {
    try {
      fs.unlinkSync(PORT_FILE);
    } catch {}
  }
}

export const engine = new BrowserEngine();
