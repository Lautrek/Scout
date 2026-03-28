/**
 * Browser discovery — scan for running browsers with open debug ports.
 *
 * Checks well-known ports for Chrome DevTools Protocol (CDP) and
 * Firefox BiDi endpoints. Returns metadata about each discovered instance.
 */

export interface BrowserInstance {
  browser: "chromium" | "firefox" | "unknown";
  url: string;
  port: number;
  version: string;
  pages: number;
}

const CANDIDATES = [
  { port: 9222, label: "Chrome/Chromium default" },
  { port: 9229, label: "Scout default" },
  { port: 9223, label: "Firefox BiDi" },
  { port: 6000, label: "Firefox Marionette" },
];

/**
 * Probe a single port for a CDP or BiDi endpoint.
 * Chrome exposes /json/version, Firefox exposes /json or BiDi WebSocket.
 */
async function probePort(port: number): Promise<BrowserInstance | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    // Try Chrome CDP endpoint first (/json/version)
    try {
      const resp = await fetch(`http://localhost:${port}/json/version`, {
        signal: controller.signal,
      });
      if (resp.ok) {
        const data = await resp.json();
        const browser = (data.Browser ?? "").toLowerCase();
        const isFirefox = browser.includes("firefox");

        let pages = 0;
        try {
          const listResp = await fetch(`http://localhost:${port}/json/list`, {
            signal: controller.signal,
          });
          if (listResp.ok) {
            const list = await listResp.json();
            pages = Array.isArray(list) ? list.length : 0;
          }
        } catch {}

        return {
          browser: isFirefox ? "firefox" : "chromium",
          url: `http://localhost:${port}`,
          port,
          version: data.Browser ?? data["User-Agent"] ?? "unknown",
          pages,
        };
      }
    } catch {}

    // Try Firefox BiDi — Firefox returns 404 on /json/version but responds
    // on the port with an HTML page. Check if it's a WebSocket BiDi endpoint.
    try {
      const resp = await fetch(`http://localhost:${port}`, {
        signal: controller.signal,
      });
      // Firefox BiDi returns a 404 HTML page but the HTTP server is up
      // The real test: can we see it's Firefox from the response?
      if (resp.status === 404 || resp.status === 200) {
        const text = await resp.text();
        // Firefox's BiDi HTTP server returns HTML 404 pages
        if (text.includes("404") || text.includes("Not Found")) {
          return {
            browser: "firefox",
            url: `ws://localhost:${port}`,
            port,
            version: "Firefox (BiDi)",
            pages: 0, // Can't enumerate pages over HTTP for BiDi
          };
        }
      }
    } catch {}
  } finally {
    clearTimeout(timer);
  }

  return null;
}

/**
 * Discover all running browser instances with debug ports.
 * Scans well-known ports plus any custom ports provided.
 */
export async function discoverBrowsers(
  extraPorts: number[] = []
): Promise<BrowserInstance[]> {
  const ports = new Set([
    ...CANDIDATES.map((c) => c.port),
    ...extraPorts,
  ]);

  const results = await Promise.all(
    [...ports].map((port) => probePort(port))
  );

  return results.filter((r): r is BrowserInstance => r !== null);
}

/**
 * Find the best browser to connect to.
 * Prefers: explicit URL > running instance with most pages > first found.
 */
export async function findBestBrowser(
  preferredUrl?: string,
  extraPorts: number[] = []
): Promise<BrowserInstance | null> {
  if (preferredUrl) {
    // Extract port from URL and probe it
    try {
      const url = new URL(preferredUrl);
      const port = parseInt(url.port);
      if (port) {
        const instance = await probePort(port);
        if (instance) {
          instance.url = preferredUrl;
          return instance;
        }
      }
    } catch {
      // Invalid URL
    }
    return null;
  }

  const instances = await discoverBrowsers(extraPorts);
  if (instances.length === 0) return null;

  // Prefer instance with most pages (more likely to be the user's main browser)
  instances.sort((a, b) => b.pages - a.pages);
  return instances[0];
}
