import { engine } from "../browser/engine.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
const SESSIONS_DIR = path.join(os.homedir(), ".scout-sessions");
/** Save current browser session (cookies, localStorage) to a named file. */
export async function saveSession(name) {
    const context = await engine.getContext();
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    const filePath = path.join(SESSIONS_DIR, `${name}.json`);
    await context.storageState({ path: filePath });
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
/** List all saved sessions. */
export async function listSessions() {
    try {
        const files = await fs.readdir(SESSIONS_DIR);
        return files
            .filter((f) => f.endsWith(".json"))
            .map((f) => f.replace(".json", ""));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=session.js.map