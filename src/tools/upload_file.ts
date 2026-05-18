import type { ElementHandle, JSHandle, Page } from "playwright";
import { engine } from "../browser/engine.js";

export interface UploadFileOptions {
  path: string;
  selector?: string;
  index?: number;
  parent_match?: string;
  confirm_button?: string;
  confirm_timeout_ms?: number;
}

export interface UploadFileResult {
  uploaded: string;
  matched_input: { index: number; parentText: string };
  confirmed: boolean;
  button_clicked?: string;
}

/**
 * Deep-walk JS that finds every <input type=file> across the document
 * including those nested inside arbitrary shadow roots. Studio, Meta, X,
 * LinkedIn all hide upload inputs at varying shadow depths.
 *
 * Exported for unit testing — the shape of this string is part of the
 * contract with browser DOM APIs.
 */
export const FIND_FILE_INPUTS_JS = `
(parentMatch) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.tagName === 'INPUT' && n.type === 'file') {
      const host = n.closest('[role=region], section, ytcp-form-file-picker, ytcp-form-uploader, ytcp-banner-upload, ytcp-profile-image-upload') || n.parentElement;
      const parentText = (host && host.innerText || '').slice(0, 200).trim();
      out.push({ el: n, parentText });
    }
    n.childNodes && n.childNodes.forEach(walk);
    if (n.shadowRoot) walk(n.shadowRoot);
  };
  walk(document);
  if (parentMatch) {
    const re = new RegExp(parentMatch, 'i');
    return out.filter(x => re.test(x.parentText));
  }
  return out;
}
`;

// Confirm-button click-when-enabled is delegated to dom_walk.ts so all the
// "find button by text in shadow DOM" logic lives in one place.
export { CLICK_BUTTON_BY_REGEX_JS } from "./dom_walk.js";
import { CLICK_BUTTON_BY_REGEX_JS } from "./dom_walk.js";

export async function uploadFileImpl(
  page: Page,
  opts: UploadFileOptions
): Promise<UploadFileResult> {
  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (!el) {
      throw new Error(`No file input matched selector: ${opts.selector}`);
    }
    await el.setInputFiles(opts.path);
    const result: UploadFileResult = {
      uploaded: opts.path,
      matched_input: { index: -1, parentText: opts.selector },
      confirmed: false,
    };
    await maybeConfirm(page, opts, result);
    return result;
  }

  const handle = (await page.evaluateHandle(
    FIND_FILE_INPUTS_JS,
    opts.parent_match ?? null
  )) as JSHandle<Array<{ el: HTMLInputElement; parentText: string }>>;

  const count: number = await handle.evaluate((arr) => arr.length);
  if (count === 0) {
    throw new Error(
      opts.parent_match
        ? `No file input whose container text matches /${opts.parent_match}/i`
        : "No file inputs found anywhere in the page (including shadow DOM)"
    );
  }

  const idx = opts.index ?? 0;
  if (idx >= count) {
    throw new Error(
      `index ${idx} out of range — only ${count} file input(s) found`
    );
  }

  const elHandle = (await handle.evaluateHandle(
    (arr, i) => (arr as any[])[i as number].el,
    idx
  )) as JSHandle<HTMLInputElement>;
  const parentText: string = await handle.evaluate(
    (arr, i) => (arr as any[])[i as number].parentText,
    idx
  );
  const inputEl = elHandle.asElement() as ElementHandle<HTMLInputElement> | null;
  if (!inputEl) {
    throw new Error("Failed to resolve file input ElementHandle");
  }

  await inputEl.setInputFiles(opts.path);

  const result: UploadFileResult = {
    uploaded: opts.path,
    matched_input: { index: idx, parentText },
    confirmed: false,
  };
  await maybeConfirm(page, opts, result);
  return result;
}

async function maybeConfirm(
  page: Page,
  opts: UploadFileOptions,
  result: UploadFileResult
): Promise<void> {
  if (!opts.confirm_button) return;
  const timeoutMs = opts.confirm_timeout_ms ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = (await page.evaluate(
      CLICK_BUTTON_BY_REGEX_JS,
      opts.confirm_button
    )) as string | null;
    if (clicked) {
      result.confirmed = true;
      result.button_clicked = clicked;
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function uploadFileTool(
  opts: UploadFileOptions
): Promise<UploadFileResult> {
  const page = await engine.getPage();
  return uploadFileImpl(page, opts);
}
