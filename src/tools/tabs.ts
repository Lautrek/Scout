import { engine } from "../browser/engine.js";
import { clearElements } from "../browser/a11y.js";

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export async function tabsTool(): Promise<TabInfo[]> {
  const pages = await engine.getPages();
  const active = await engine.getPage();

  const tabs: TabInfo[] = await Promise.all(
    pages.map(async (p, i) => ({
      index: i,
      url: p.url(),
      title: await p.title().catch(() => ""),
      active: p === active,
    }))
  );

  return tabs;
}

export async function switchTabTool(index: number): Promise<TabInfo> {
  const page = await engine.switchPage(index);
  clearElements(); // IDs are stale on tab switch
  return {
    index,
    url: page.url(),
    title: await page.title().catch(() => ""),
    active: true,
  };
}

export async function newTabTool(url?: string): Promise<TabInfo> {
  const page = await engine.newPage();
  clearElements();
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}
  }
  const pages = await engine.getPages();
  return {
    index: pages.indexOf(page),
    url: page.url(),
    title: await page.title().catch(() => ""),
    active: true,
  };
}
