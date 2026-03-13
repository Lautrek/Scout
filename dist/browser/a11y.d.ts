import { Page } from "playwright";
import { ScoutElement } from "../types.js";
/**
 * Standalone script that injects data-scout-id attributes into the DOM.
 * Can be run via page.evaluate() after DOM mutations to keep IDs fresh.
 * Exported for use by healer.ts.
 */
export declare const INJECT_SCOUT_IDS_SCRIPT = "(() => {\n  const SELECTORS = [\n    \"a[href]\", \"button\", 'input:not([type=\"hidden\"])', \"select\", \"textarea\",\n    '[role=\"button\"]', '[role=\"link\"]', '[role=\"checkbox\"]', '[role=\"radio\"]',\n    '[role=\"combobox\"]', '[role=\"listbox\"]', '[role=\"option\"]', '[role=\"menuitem\"]',\n    '[role=\"tab\"]', '[role=\"switch\"]', '[role=\"slider\"]', '[role=\"searchbox\"]',\n    '[role=\"spinbutton\"]', \"h1, h2, h3, h4, h5, h6\"\n  ].join(\", \");\n\n  // Find the highest existing ID so we continue from there\n  let maxId = 0;\n  document.querySelectorAll(\"[data-scout-id]\").forEach(el => {\n    const id = parseInt(el.getAttribute(\"data-scout-id\") || \"0\");\n    if (id > maxId) maxId = id;\n  });\n\n  // Only inject IDs into elements that don't already have one\n  const seen = new Set(Array.from(document.querySelectorAll(\"[data-scout-id]\")));\n  let counter = maxId + 1;\n  document.querySelectorAll(SELECTORS).forEach(el => {\n    if (seen.has(el)) return;\n    const rect = el.getBoundingClientRect();\n    if (rect.width === 0 && rect.height === 0) return;\n    const style = window.getComputedStyle(el);\n    if (style.display === \"none\" || style.visibility === \"hidden\" || parseFloat(style.opacity) === 0) return;\n    el.setAttribute(\"data-scout-id\", String(counter++));\n    seen.add(el);\n  });\n  return counter - 1;\n})()";
export declare function getElement(id: number): ScoutElement | undefined;
export declare function setLastElements(elements: ScoutElement[]): void;
export declare function clearElements(): void;
export declare function extractA11yElements(page: Page): Promise<ScoutElement[]>;
export declare function buildMarkdown(url: string, title: string, elements: ScoutElement[]): string;
//# sourceMappingURL=a11y.d.ts.map