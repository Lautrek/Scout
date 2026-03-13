export interface SessionMeta {
    name: string;
    saved_at: string;
    url: string;
    title: string;
    cookie_count: number;
}
/** Save current browser session (cookies, localStorage) to a named file.
 *  Also writes a .meta.json sidecar with timestamp, URL, title, and cookie count.
 */
export declare function saveSession(name: string): Promise<string>;
/** Load a browser session from a named file. Restarts the browser context. */
export declare function loadSession(name: string): Promise<void>;
/** List all saved sessions with metadata if available. Always returns uniform objects. */
export declare function listSessions(): Promise<Array<{
    name: string;
    meta: SessionMeta | null;
}>>;
/** Read session metadata without loading the session. */
export declare function getSessionMeta(name: string): Promise<SessionMeta | null>;
//# sourceMappingURL=session.d.ts.map