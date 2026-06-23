import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync, spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolves to <repo-root>/scripts/scout_baseline.sh; override with env var for alternate layouts
const SCRIPT = process.env.SCOUT_BASELINE_SCRIPT ??
  fileURLToPath(new URL("../../../../scripts/scout_baseline.sh", import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

function bash(scriptBody: string, env: NodeJS.ProcessEnv = {}): RunResult {
  const r = spawnSync("bash", ["-c", scriptBody], {
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status ?? -1,
  };
}

/**
 * Spawn a long-sleep process at a path that contains the literal string
 * 'scout/src/index.ts' so the script's pgrep -af regex picks it up. The
 * `exec -a` trick alone won't work because pgrep -f matches the full
 * command line, and bash -c rewrites argv after exec.
 *
 * Returns the child + its pid. Caller must kill it in a finally block.
 */
function spawnFakeDaemon(rootDir: string, suffix: string): ChildProcess {
  const fakeDir = join(rootDir, "scout", "src");
  mkdirSync(fakeDir, { recursive: true });
  const fakePath = join(fakeDir, "index.ts");
  // Bash treats any file as a script if invoked directly — make it a
  // valid no-op that just sleeps. We DON'T `exec sleep` because that
  // replaces the bash process and removes the script path from cmdline,
  // which would break pgrep -f matching.
  writeFileSync(fakePath, "#!/usr/bin/env bash\nsleep 30\n", { mode: 0o755 });
  // Run the fake script — its full cmdline will contain "scout/src/index.ts"
  // unref() so Node doesn't hold the reference (otherwise the killed
  // child stays as a zombie until vitest exits, and `kill -0` would
  // still return 0 even though the process is functionally dead).
  const child = spawn("bash", [fakePath], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  return child;
}

/**
 * Tells whether a pid is fully reclaimed by the OS (i.e. neither alive
 * nor a zombie). A zombie process answers `kill -0` truthfully but is
 * dead from a behavior standpoint — distinguishing matters in tests
 * because Node-spawned children become zombies until their parent
 * reaps them.
 */
function isFullyDead(pid: number): boolean {
  // /proc/<pid>/status doesn't exist once the OS reaps the entry.
  // For zombies, status[State] starts with 'Z'.
  const r = spawnSync("cat", [`/proc/${pid}/status`], { encoding: "utf-8" });
  if (r.status !== 0) return true; // entry gone — fully dead
  const stateLine = (r.stdout || "")
    .split("\n")
    .find((l) => l.startsWith("State:"));
  if (!stateLine) return true;
  return stateLine.includes("Z"); // zombie counts as dead for our purposes
}

let tmpDir: string;
let pidFile: string;
let portFile: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "scout-baseline-test-"));
  pidFile = join(tmpDir, "daemon.pid");
  portFile = join(tmpDir, "lcp.port");
});

afterEach(() => {
  for (const c of children.splice(0)) {
    if (c.pid) {
      try {
        process.kill(c.pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("scout_baseline.sh: script-level smoke", () => {
  it("passes bash -n syntax check", () => {
    const r = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf-8" });
    expect(r.status).toBe(0);
  });

  it("exits non-zero with usage on unknown flag", () => {
    const r = bash(`"${SCRIPT}" --no-such-flag`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Usage:/);
  });

  it("usage line documents the new --reap subcommand", () => {
    const r = bash(`"${SCRIPT}" --no-such-flag`);
    expect(r.stderr).toMatch(/--reap/);
  });
});

/**
 * Helper that sources just the orphan-handling functions out of the script
 * via awk so we can drive them directly without booting the daemon.
 */
const SOURCE_HELPERS_SH = `
eval "$(awk '/^list_orphan_daemons\\(\\)/,/^\\}/' "${SCRIPT}")"
eval "$(awk '/^reap_orphan_daemons\\(\\)/,/^\\}/' "${SCRIPT}")"
`;

describe("scout_baseline.sh: list_orphan_daemons", () => {
  it("returns a usable empty/non-empty list without erroring", () => {
    const r = bash(`set -e
${SOURCE_HELPERS_SH}
PID_FILE="${pidFile}"
list_orphan_daemons || true
`);
    expect(r.status).toBe(0);
    // Output is either empty or a list of integers, one per line
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      expect(line).toMatch(/^\d+$/);
    }
  });

  it("excludes the pid recorded in PID_FILE", () => {
    const child = spawnFakeDaemon(tmpDir, "current");
    children.push(child);
    spawnSync("sleep", ["0.4"]);
    expect(child.pid).toBeTruthy();
    writeFileSync(pidFile, String(child.pid));

    const r = bash(`set -e
${SOURCE_HELPERS_SH}
PID_FILE="${pidFile}"
list_orphan_daemons
`);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    expect(lines.includes(String(child.pid))).toBe(false);
  });

  it("returns the orphan pid when it differs from PID_FILE's pid", () => {
    const orphan = spawnFakeDaemon(tmpDir, "orphan");
    children.push(orphan);
    spawnSync("sleep", ["0.4"]);
    expect(orphan.pid).toBeTruthy();

    // Pretend the "current" pid is something completely unrelated
    writeFileSync(pidFile, "1");

    const r = bash(`set -e
${SOURCE_HELPERS_SH}
PID_FILE="${pidFile}"
list_orphan_daemons
`);
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    expect(lines.includes(String(orphan.pid))).toBe(true);
  });
});

describe("scout_baseline.sh: reap_orphan_daemons", () => {
  it("kills orphan processes whose pid is not in PID_FILE", () => {
    const orphan = spawnFakeDaemon(tmpDir, "doomed");
    children.push(orphan);
    spawnSync("sleep", ["0.4"]);
    expect(orphan.pid).toBeTruthy();
    const orphanPid = orphan.pid!;

    // PID_FILE points at an unrelated pid, so the orphan is reaped
    writeFileSync(pidFile, "1");

    const r = bash(`set -e
${SOURCE_HELPERS_SH}
PID_FILE="${pidFile}"
reap_orphan_daemons 2>&1
`);
    expect(r.status).toBe(0);

    // Reap waits 1s between SIGTERM and SIGKILL; give it a moment beyond.
    spawnSync("sleep", ["0.5"]);
    expect(isFullyDead(orphanPid)).toBe(true);
  });

  it("does NOT kill the process recorded in PID_FILE", () => {
    const keeper = spawnFakeDaemon(tmpDir, "keeper");
    children.push(keeper);
    spawnSync("sleep", ["0.4"]);
    expect(keeper.pid).toBeTruthy();
    const keeperPid = keeper.pid!;

    writeFileSync(pidFile, String(keeperPid));

    const r = bash(`set -e
${SOURCE_HELPERS_SH}
PID_FILE="${pidFile}"
reap_orphan_daemons 2>&1
`);
    expect(r.status).toBe(0);

    spawnSync("sleep", ["0.3"]);
    expect(isFullyDead(keeperPid)).toBe(false);
  });

  it("is a no-op when no orphans exist", () => {
    writeFileSync(pidFile, "1");
    const r = bash(`set -e
${SOURCE_HELPERS_SH}
PID_FILE="${pidFile}"
reap_orphan_daemons 2>&1
`);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/reaped/);
  });
});
