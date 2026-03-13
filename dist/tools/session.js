import { engine } from "../browser/engine.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
const SESSIONS_DIR = path.join(os.homedir(), ".scout-sessions");
/** Save current browser session (cookies, localStorage) to a named file.
 *  Also writes a .meta.json sidecar with timestamp, URL, title, and cookie count.
 */
export async function saveSession(name) {
    const context = await engine.getContext();
    const page = await engine.getPage();
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    const filePath = path.join(SESSIONS_DIR, `${name}.json`);
    const metaPath = path.join(SESSIONS_DIR, `${name}.meta.json`);
    await context.storageState({ path: filePath });
    // Read the saved state to count cookies
    let cookieCount = 0;
    try {
        const state = JSON.parse(await fs.readFile(filePath, "utf-8"));
        cookieCount = (state.cookies ?? []).length;
    }
    catch { }
    const meta = {
        name,
        saved_at: new Date().toISOString(),
        url: page.url(),
        title: await page.title(),
        cookie_count: cookieCount,
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return filePath;
}
/** Load a browser session from a named file. Restarts the browser context. */
export async function loadSession(name) {
    const filePath = path.join(SESSIONS_DIR, `${name}.json`);
    try {
        await fs.access(filePath);
    }
    catch {
        throw new Error(`Session "${name}" not found at ${filePath}`);
    }
    await engine.restartContext(filePath);
}
/** List all saved sessions with metadata if available. */
export async function listSessions() {
    try {
        const files = await fs.readdir(SESSIONS_DIR);
        const sessions = files
            .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
            .map((f) => f.replace(".json", ""));
        const results = await Promise.all(sessions.map(async (name) => {
            const metaPath = path.join(SESSIONS_DIR, `${name}.meta.json`);
            try {
                const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
                return { name, meta };
            }
            catch {
                return name;
            }
        }));
        return results;
    }
    catch {
        return [];
    }
}
/** Read session metadata without loading the session. */
export async function getSessionMeta(name) {
    const metaPath = path.join(SESSIONS_DIR, `${name}.meta.json`);
    try {
        return JSON.parse(await fs.readFile(metaPath, "utf-8"));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=session.js.map