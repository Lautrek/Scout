/**
 * Self-heal helpers for when the connected browser dies under us.
 *
 * Symptom (observed today): chrome at port 9223 OOM-crashes; Scout's daemon
 * survives because it's a separate node process; subsequent tool calls fail
 * with "Target page, context or browser has been closed". Without recovery
 * the user has to manually run studio_baseline.sh + scout_baseline.sh
 * --restart. With recovery, the daemon does both transparently on first
 * trip-up.
 *
 * The recovery logic is split out from engine.ts so it can be unit-tested
 * without booting a real browser.
 */

import { spawn } from "node:child_process";

/** Substrings that indicate the browser/context is gone. */
const CLOSED_PATTERNS = [
  "Target page, context or browser has been closed",
  "Target closed",
  "Browser has been closed",
  "browser has disconnected",
  "Page has been closed",
  "BrowserContext is closed",
];

/**
 * Pure: classify whether an error means our browser session is dead.
 */
export function isContextClosedError(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err ?? "");
  return CLOSED_PATTERNS.some((p) => msg.includes(p));
}

export interface SelfHealOptions {
  /** Command to spawn for recovery. Default: studio_baseline.sh. */
  command?: string;
  /** Args to pass to the command. */
  args?: string[];
  /** Max ms the heal command is allowed to take. */
  timeout_ms?: number;
}

export interface SelfHealResult {
  ran: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

/**
 * Run the heal command and capture its output. The default points at the
 * Lautrek studio_baseline.sh — projects can override via env or by passing
 * an explicit command.
 */
export async function runSelfHeal(
  opts: SelfHealOptions = {}
): Promise<SelfHealResult> {
  const command =
    opts.command ??
    process.env.SCOUT_SELF_HEAL_CMD ??
    "/home/riga/Projects/Lautrek/scripts/studio_baseline.sh";
  const args = opts.args ?? [];
  const timeoutMs = opts.timeout_ms ?? 30_000;

  const start = Date.now();
  return new Promise<SelfHealResult>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);
    child.stdout?.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr?.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(t);
      resolve({
        ran: true,
        status: code,
        stdout,
        stderr,
        duration_ms: Date.now() - start,
      });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({
        ran: false,
        status: null,
        stdout,
        stderr: stderr + (e?.message ?? String(e)),
        duration_ms: Date.now() - start,
      });
    });
  });
}

export interface WithSelfHealHooks {
  /** Called once when a context-closed error is intercepted. */
  onTrip?: (err: unknown) => void;
  /**
   * Called to flush internal state (browser/context refs) before retry.
   * Engine wires this to nullify its cached browser/context.
   */
  beforeRetry: () => Promise<void> | void;
  /**
   * Heal action. Returns true to attempt the retry, false to give up
   * and rethrow the original error. Default: invoke runSelfHeal.
   */
  heal?: () => Promise<boolean>;
}

/**
 * Run an async operation; if it fails with a "context closed" error,
 * invoke the heal hook, flush cached state, and retry once. Any other
 * error (and a second failure after heal) propagates unchanged.
 *
 * Pure-ish: takes its dependencies as hooks so tests can drive it
 * without spawning processes.
 */
export async function withSelfHeal<T>(
  op: () => Promise<T>,
  hooks: WithSelfHealHooks
): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isContextClosedError(err)) throw err;
    hooks.onTrip?.(err);
    const heal = hooks.heal ?? (async () => (await runSelfHeal()).status === 0);
    const ok = await heal();
    if (!ok) throw err;
    await hooks.beforeRetry();
    return await op();
  }
}
