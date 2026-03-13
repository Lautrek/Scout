const MAX_ELEMENTS = parseInt(process.env.SCOUT_MAX_ELEMENTS ?? "1000");
/**
 * Standalone script that injects data-scout-id attributes into the DOM.
 * Can be run via page.evaluate() after DOM mutations to keep IDs fresh.
 * Exported for use by healer.ts.
 */
export const INJECT_SCOUT_IDS_SCRIPT = `(() => {
  const SELECTORS = [
    "a[href]", "button", 'input:not([type="hidden"])', "select", "textarea",
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="combobox"]', '[role="listbox"]', '[role="option"]', '[role="menuitem"]',
    '[role="tab"]', '[role="switch"]', '[role="slider"]', '[role="searchbox"]',
    '[role="spinbutton"]', "h1, h2, h3, h4, h5, h6"
  ].join(", ");

  // Find the highest existing ID so we continue from there
  let maxId = 0;
  document.querySelectorAll("[data-scout-id]").forEach(el => {
    const id = parseInt(el.getAttribute("data-scout-id") || "0");
    if (id > maxId) maxId = id;
  });

  // Only inject IDs into elements that don't already have one
  const seen = new Set(Array.from(document.querySelectorAll("[data-scout-id]")));
  let counter = maxId + 1;
  document.querySelectorAll(SELECTORS).forEach(el => {
    if (seen.has(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return;
    el.setAttribute("data-scout-id", String(counter++));
    seen.add(el);
  });
  return counter - 1;
})()`;
let _lastElements = [];
export function getElement(id) {
    return _lastElements.find((e) => e.id === id);
}
export function setLastElements(elements) {
    _lastElements = elements;
}
export function clearElements() {
    _lastElements = [];
}
export async function extractA11yElements(page) {
    const MAX = MAX_ELEMENTS;
    const domElements = await page.evaluate((max) => {
        // Clear previous IDs
        document.querySelectorAll("[data-scout-id]").forEach((el) => el.removeAttribute("data-scout-id"));
        const SELECTORS = [
            "a[href]",
            "button",
            'input:not([type="hidden"])',
            "select",
            "textarea",
            '[role="button"]',
            '[role="link"]',
            '[role="checkbox"]',
            '[role="radio"]',
            '[role="combobox"]',
            '[role="listbox"]',
            '[role="option"]',
            '[role="menuitem"]',
            '[role="tab"]',
            '[role="switch"]',
            '[role="slider"]',
            '[role="searchbox"]',
            '[role="spinbutton"]',
            "h1, h2, h3, h4, h5, h6",
        ].join(", ");
        const results = [];
        const seen = new Set();
        let counter = 1;
        document.querySelectorAll(SELECTORS).forEach((el) => {
            if (seen.has(el) || results.length >= max)
                return;
            seen.add(el);
            // Visibility check
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0)
                return;
            const style = window.getComputedStyle(el);
            if (style.display === "none" ||
                style.visibility === "hidden" ||
                parseFloat(style.opacity) === 0)
                return;
            const tag = el.tagName.toLowerCase();
            const explicitRole = el.getAttribute("role") ?? "";
            // Derive semantic role
            let role = explicitRole;
            if (!role) {
                if (tag === "a")
                    role = "link";
                else if (tag === "button")
                    role = "button";
                else if (tag === "input") {
                    const type = el.type.toLowerCase();
                    if (type === "checkbox")
                        role = "checkbox";
                    else if (type === "radio")
                        role = "radio";
                    else if (type === "submit" || type === "button" || type === "reset")
                        role = "button";
                    else
                        role = "textbox";
                }
                else if (tag === "select")
                    role = "combobox";
                else if (tag === "textarea")
                    role = "textbox";
                else if (/^h[1-6]$/.test(tag))
                    role = "heading";
                else
                    role = tag;
            }
            // Best-effort label
            const ariaLabel = el.getAttribute("aria-label") ?? "";
            const ariaLabelledBy = el.getAttribute("aria-labelledby");
            let labelledText = "";
            if (ariaLabelledBy) {
                for (const id of ariaLabelledBy.split(/\s+/)) {
                    const ref = document.getElementById(id);
                    if (ref)
                        labelledText += ref.textContent?.trim() + " ";
                }
                labelledText = labelledText.trim();
            }
            const alt = el.alt ?? "";
            const title = el.getAttribute("title") ?? "";
            const textContent = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) ?? "";
            const label = (ariaLabel || labelledText || alt || title || textContent).trim();
            const nonLabelledInputRoles = new Set(["textbox", "searchbox", "combobox", "textarea"]);
            if (!label && !nonLabelledInputRoles.has(role))
                return;
            el.setAttribute("data-scout-id", String(counter));
            const inputEl = el;
            const isToggle = role === "checkbox" || role === "radio" || role === "switch";
            results.push({
                id: counter++,
                role,
                label: label.slice(0, 200),
                value: inputEl.value ?? "",
                placeholder: el.getAttribute("placeholder") ?? "",
                checked: isToggle ? inputEl.checked : undefined,
                enabled: !el.disabled,
            });
        });
        return results;
    }, MAX);
    const elements = domElements.map((d) => ({
        id: d.id,
        role: d.role,
        label: d.label,
        ...(d.value ? { value: d.value } : {}),
        ...(d.placeholder ? { placeholder: d.placeholder } : {}),
        ...(d.checked !== undefined ? { checked: d.checked } : {}),
        enabled: d.enabled,
        visible: true,
    }));
    setLastElements(elements);
    return elements;
}
export function buildMarkdown(url, title, elements) {
    const lines = [`## Page: ${title}`, `URL: ${url}`, ""];
    for (const el of elements) {
        let line = `[${el.id}] ${capitalize(el.role)}: ${el.label}`;
        if (el.placeholder) {
            line += ` (placeholder: ${el.placeholder})`;
        }
        if (el.value) {
            line += ` (value: ${el.value})`;
        }
        if (el.checked !== undefined) {
            line += ` [${el.checked ? "checked" : "unchecked"}]`;
        }
        if (!el.enabled) {
            line += " [disabled]";
        }
        lines.push(line);
    }
    return lines.join("\n");
}
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
//# sourceMappingURL=a11y.js.map