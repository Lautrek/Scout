/** Save current browser session (cookies, localStorage) to a named file. */
export declare function saveSession(name: string): Promise<string>;
/** Load a browser session from a named file. Restarts the browser context. */
export declare function loadSession(name: string): Promise<void>;
/** List all saved sessions. */
export declare function listSessions(): Promise<string[]>;
//# sourceMappingURL=session.d.ts.map