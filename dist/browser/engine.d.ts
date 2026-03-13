import { Page, BrowserContext } from "playwright";
declare class BrowserEngine {
    private browser;
    private context;
    private _activePage;
    private _persistent;
    private logs;
    private blockedResources;
    /** Get collected console logs. */
    getLogs(): string[];
    /** Clear collected console logs. */
    clearLogs(): void;
    /** Set resource types to block (image, media, stylesheet, font, script) */
    setBlockedResources(types: string[]): Promise<void>;
    /** Returns the active context, reconnecting to or launching the browser as needed. */
    getContext(): Promise<BrowserContext>;
    /** Returns the active page, reconnecting to or launching the browser as needed. */
    getPage(): Promise<Page>;
    /** All open pages (tabs) in the current context. */
    getPages(): Promise<Page[]>;
    /** Switch active page to a specific index or URL match. */
    switchPage(indexOrUrl: number | string): Promise<Page>;
    /** Open a new tab and make it active. */
    newPage(): Promise<Page>;
    close(): Promise<void>;
    restartContext(storageStatePath?: string): Promise<void>;
    private _ensureBrowser;
    private _applyBlockedResources;
    private _setupPage;
    private _readPortFile;
    private _writePortFile;
    private _clearPortFile;
}
export declare const engine: BrowserEngine;
export {};
//# sourceMappingURL=engine.d.ts.map