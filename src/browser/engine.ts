import { chromium as chromiumExtra, firefox as firefoxExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Browser, Page, BrowserContext } from "playwright";
import { discoverBrowsers, findBestBrowser } from "./discovery.js";

// Register stealth on Chromium (no-op on Firefox — stealth isn't needed there)
chromiumExtra.use(StealthPlugin());
import fs from "fs";
import os from "os";
import path from "path";

// ── Configuration ──────────────────────────────────────────────────────────

// Mode: "connect" (attach to user's browser), "launch" (start fresh), "auto" (try connect, fallback to launch)
const MODE = (process.env.SCOUT_MODE ?? "auto").toLowerCase();
// Explicit CDP/BiDi URL to connect to (overrides discovery)
const CONNECT_URL = process.env.SCOUT_CONNECT_URL ?? "";

const HEADLESS = process.env.SCOUT_HEADLESS === "true";
const VIEWPORT_WIDTH = parseInt(process.env.SCOUT_VIEWPORT_WIDTH ?? "1280");
const VIEWPORT_HEIGHT = parseInt(process.env.SCOUT_VIEWPORT_HEIGHT ?? "800");
const CDP_PORT = parseInt(process.env.SCOUT_CDP_PORT ?? "9229");
const PORT_FILE = path.join(os.homedir(), ".scout-browser.port");
const MAX_TABS = parseInt(process.env.SCOUT_MAX_TABS ?? "5");

const BROWSER_TYPE = (process.env.SCOUT_BROWSER ?? "chromium").toLowerCase();
const PROFILE_DIR = process.env.SCOUT_PROFILE_DIR ?? "";
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

class BrowserEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private _activePage: Page | null = null;
  private _persistent = false;
  private _connected = false; // true when attached to user's browser
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

  /** Whether we're connected to an external browser (not one we launched). */
  get isConnected(): boolean {
    return this._connected;
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

  /** Returns the active context. */
  async getContext(): Promise<BrowserContext> {
    await this._ensureBrowser();
    return this.context!;
  }

  /** Returns the active page. */
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
    console.error("Scout: creating new page");
    await this._ensureBrowser();
    if (!this.context) {
      throw new Error("Browser context not available after _ensureBrowser");
    }

    // Enforce tab limit (only for launched browsers — don't close user's tabs)
    if (!this._connected) {
      const pages = this.context.pages();
      if (pages.length >= MAX_TABS) {
        console.error(`Scout: tab limit reached (${MAX_TABS}), closing oldest tab`);
        await pages[0].close();
      }
    }

    this._activePage = await this.context!.newPage();
    console.error(`Scout: new page created, total pages: ${this.context!.pages().length}`);
    return this._activePage;
  }

  async close(): Promise<void> {
    if (this._connected) {
      // Connected to user's browser — disconnect, DON'T close
      this.browser = null;
      this.context = null;
      this._activePage = null;
      this._connected = false;
      console.error("Scout: disconnected from browser (browser still running)");
    } else if (this._persistent && this.context) {
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
    if (this.context && !this._connected) {
      await this.context.close();
      this.context = null;
    }
    await this._ensureBrowser(storageStatePath);
  }

  // ── Core browser initialization ────────────────────────────────────────

  private async _ensureBrowser(storageStatePath?: string): Promise<void> {
    // Already running
    if (this._connected && this.context) return;
    if (this._persistent && this.context && !storageStatePath) return;
    if (!this._persistent && this.browser?.isConnected() && this.context && !storageStatePath) return;

    // ── Connect mode: attach to user's existing browser ──────────────
    if (MODE === "connect" || CONNECT_URL) {
      await this._connectToExisting(CONNECT_URL || undefined);
      return;
    }

    // ── Auto mode: try connect first, then fall back to launch ───────
    if (MODE === "auto") {
      const connected = await this._tryConnect(storageStatePath);
      if (connected) return;
      // Fall through to launch
    }

    // ── Persistent profile mode ──────────────────────────────────────
    if (PROFILE_DIR && !storageStatePath) {
      await this._launchPersistent();
      return;
    }

    // ── Launch mode: start fresh browser ─────────────────────────────
    await this._launchFresh(storageStatePath);
  }

  /**
   * Connect to an existing browser via CDP (Chrome) or BiDi (Firefox).
   * Attaches to the user's default context — sees all their open tabs.
   */
  private async _connectToExisting(url?: string): Promise<void> {
    const instance = await findBestBrowser(url);

    if (!instance) {
      const hint = url
        ? `Could not connect to browser at ${url}.`
        : "No browser with debug port found.";
      throw new Error(
        `${hint}\n` +
        `Start your browser with remote debugging enabled:\n` +
        `  Chrome:  google-chrome --remote-debugging-port=9222\n` +
        `  Firefox: firefox --remote-debugging-port 9222\n` +
        `  Edge:    msedge --remote-debugging-port=9222\n`
      );
    }

    console.error(`Scout: connecting to ${instance.browser} at ${instance.url} (${instance.version}, ${instance.pages} tabs)`);

    if (instance.browser === "firefox") {
      // Firefox uses WebDriver BiDi — connect via Playwright's firefox.connect()
      const wsUrl = instance.url.replace(/^http/, "ws");
      this.browser = await firefoxExtra.connect(wsUrl, {
        timeout: 10_000,
      });
    } else {
      // Chrome/Chromium uses CDP
      this.browser = await chromiumExtra.connectOverCDP(instance.url, {
        timeout: 10_000,
      });
    }

    // Attach to the EXISTING default context — this gives us the user's tabs
    const contexts = this.browser.contexts();
    if (contexts.length > 0) {
      this.context = contexts[0];
      console.error(`Scout: attached to existing context with ${this.context.pages().length} pages`);
    } else {
      // No existing context — create one (shouldn't happen with a real browser)
      this.context = await this.browser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
      console.error("Scout: no existing context found, created new one");
    }

    // Wire up page event handlers on existing pages
    for (const p of this.context.pages()) this._setupPage(p);
    this.context.on("page", (p) => this._setupPage(p));

    this._connected = true;
    this._persistent = false;
    this._writePortFile(instance.port);

    console.error(`Scout: connected to user's ${instance.browser} browser`);
  }

  /**
   * Try to connect to an existing browser (auto mode).
   * Returns true if successful, false to fall through to launch.
   */
  private async _tryConnect(storageStatePath?: string): Promise<boolean> {
    // First check if there's a port file from a previous Scout launch
    const existingPort = this._readPortFile();
    if (existingPort) {
      try {
        this.browser = await chromiumExtra.connectOverCDP(
          `http://localhost:${existingPort}`,
          { timeout: 3000 }
        );

        if (!this.context || storageStatePath) {
          this.context = await this.browser!.newContext({
            viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
            storageState: storageStatePath,
          });
          this.context.on("page", (p) => this._setupPage(p));
          for (const p of this.context.pages()) this._setupPage(p);
          if (this.blockedResources.length > 0) {
            await this._applyBlockedResources();
          }
          this._activePage = null;
        }

        console.error(`Scout: reconnected to browser on port ${existingPort}`);
        return true;
      } catch {
        this._clearPortFile();
      }
    }

    // Try discovery — find any browser with an open debug port
    try {
      const instances = await discoverBrowsers();
      if (instances.length > 0) {
        await this._connectToExisting(instances[0].url);
        return true;
      }
    } catch {
      // Discovery failed — fall through
    }

    return false;
  }

  /** Launch with a persistent profile directory. */
  private async _launchPersistent(): Promise<void> {
    const browserType = BROWSER_TYPE === "firefox" ? firefoxExtra : chromiumExtra;
    const args = BROWSER_TYPE !== "firefox"
      ? ["--no-sandbox", "--disable-dev-shm-usage"]
      : [];

    this.context = await browserType.launchPersistentContext(PROFILE_DIR, {
      headless: HEADLESS,
      args,
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      executablePath: BROWSER_TYPE === "chromium" ? EXECUTABLE_PATH : undefined,
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
  }

  /** Launch a fresh browser instance. */
  private async _launchFresh(storageStatePath?: string): Promise<void> {
    const browserType = BROWSER_TYPE === "firefox" ? firefoxExtra : chromiumExtra;
    const args = BROWSER_TYPE !== "firefox"
      ? ["--no-sandbox", "--disable-dev-shm-usage", `--remote-debugging-port=${CDP_PORT}`]
      : [];

    this.browser = await browserType.launch({
      headless: HEADLESS,
      args,
      executablePath: BROWSER_TYPE === "chromium" ? EXECUTABLE_PATH : undefined,
    });

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

  // ── Internals ──────────────────────────────────────────────────────────

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
