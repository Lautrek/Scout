import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  uploadFileImpl,
  FIND_FILE_INPUTS_JS,
  CLICK_BUTTON_BY_REGEX_JS,
} from "../../src/tools/upload_file.js";

/**
 * Minimal fake of Playwright's Page that records evaluate / evaluateHandle /
 * setInputFiles calls. We don't actually run the JS — we just verify that the
 * tool delegates correctly.
 *
 * The deep-walk JS is sent as a string to page.evaluate; rather than booting
 * a real browser, we drive the tool with canned return values for each call
 * and assert the args it sent match the expected shape.
 */
function makePage(opts: {
  inputs?: Array<{ parentText: string }>;
  buttonClicked?: string | null | (() => string | null);
  selectorEl?: { setInputFiles: ReturnType<typeof vi.fn> } | null;
}) {
  const inputs = opts.inputs ?? [];
  const setInputFilesCalls: string[][] = [];

  // Simulate evaluateHandle returning a JSHandle that wraps `inputs`.
  // The handle's .evaluate(fn) re-runs `fn` against the captured array on the
  // node side — mirror that exactly so our impl's `arr.length` /
  // `arr[i].parentText` calls work without a real browser.
  const handle = {
    evaluate: vi.fn(async (fn: any, arg?: any) => fn(inputs, arg)),
    evaluateHandle: vi.fn(async (fn: any, arg?: any) => {
      // For arr[i].el — return a fake ElementHandle
      const target = fn(inputs, arg);
      return {
        asElement: () => ({
          setInputFiles: vi.fn(async (path: string) => {
            setInputFilesCalls.push(["index", path]);
          }),
        }),
        _target: target,
      };
    }),
  };

  const page = {
    $: vi.fn(async (sel: string) => opts.selectorEl ?? null),
    evaluateHandle: vi.fn(async (_js: string, _arg?: any) => handle),
    evaluate: vi.fn(async (js: string, arg?: any) => {
      // Confirm-button polling — return the configured value
      if (typeof opts.buttonClicked === "function")
        return (opts.buttonClicked as () => string | null)();
      return opts.buttonClicked ?? null;
    }),
  };

  return { page: page as any, setInputFilesCalls };
}

describe("upload_file: deep-walk JS shape", () => {
  it("FIND_FILE_INPUTS_JS is a valid arrow function expression", () => {
    expect(FIND_FILE_INPUTS_JS).toMatch(/=>/);
    expect(FIND_FILE_INPUTS_JS).toMatch(/walk\(document\)/);
    expect(FIND_FILE_INPUTS_JS).toMatch(/n\.shadowRoot/);
    expect(FIND_FILE_INPUTS_JS).toMatch(/type === 'file'/);
  });

  it("CLICK_BUTTON_BY_REGEX_JS pierces shadow DOM and skips disabled", () => {
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/walk\(document\)/);
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/aria-disabled/);
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/offsetParent/);
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/btn\.click\(\)/);
  });
});

describe("uploadFileImpl: selector path", () => {
  it("calls setInputFiles on the matched element when selector is set", async () => {
    const setInputFiles = vi.fn(async () => {});
    const { page } = makePage({ selectorEl: { setInputFiles } });

    const result = await uploadFileImpl(page, {
      path: "/tmp/banner.png",
      selector: "input[type=file]",
    });

    expect(setInputFiles).toHaveBeenCalledWith("/tmp/banner.png");
    expect(result).toEqual({
      uploaded: "/tmp/banner.png",
      matched_input: { index: -1, parentText: "input[type=file]" },
      confirmed: false,
    });
    expect(page.evaluateHandle).not.toHaveBeenCalled();
  });

  it("throws a clear error when selector matches nothing", async () => {
    const { page } = makePage({ selectorEl: null });
    await expect(
      uploadFileImpl(page, { path: "/tmp/x.png", selector: "input[type=file]" })
    ).rejects.toThrow(/No file input matched selector/);
  });
});

describe("uploadFileImpl: deep-walk path", () => {
  it("uses index 0 by default and reports the matched container text", async () => {
    const { page } = makePage({
      inputs: [
        { parentText: "Banner image\nUpload" },
        { parentText: "Video watermark\nUpload" },
      ],
    });

    const result = await uploadFileImpl(page, { path: "/tmp/banner.png" });

    expect(result.matched_input).toEqual({
      index: 0,
      parentText: "Banner image\nUpload",
    });
    expect(result.uploaded).toBe("/tmp/banner.png");
    expect(result.confirmed).toBe(false);
    expect(page.evaluateHandle).toHaveBeenCalledTimes(1);
    // The deep-walk JS must have been sent (not some inline literal)
    expect(page.evaluateHandle.mock.calls[0][0]).toBe(FIND_FILE_INPUTS_JS);
  });

  it("respects the index argument", async () => {
    const { page } = makePage({
      inputs: [
        { parentText: "Banner image" },
        { parentText: "Video watermark" },
      ],
    });

    const result = await uploadFileImpl(page, {
      path: "/tmp/wm.png",
      index: 1,
    });

    expect(result.matched_input.index).toBe(1);
    expect(result.matched_input.parentText).toBe("Video watermark");
  });

  it("throws when index is out of range", async () => {
    const { page } = makePage({
      inputs: [{ parentText: "Banner image" }],
    });

    await expect(
      uploadFileImpl(page, { path: "/tmp/x.png", index: 5 })
    ).rejects.toThrow(/index 5 out of range/);
  });

  it("throws when no file inputs are found anywhere", async () => {
    const { page } = makePage({ inputs: [] });

    await expect(uploadFileImpl(page, { path: "/tmp/x.png" })).rejects.toThrow(
      /No file inputs found/
    );
  });

  it("forwards parent_match to the deep-walk so it can pre-filter", async () => {
    const { page } = makePage({
      inputs: [{ parentText: "Banner image\nUpload" }],
    });

    await uploadFileImpl(page, {
      path: "/tmp/x.png",
      parent_match: "banner",
    });

    expect(page.evaluateHandle).toHaveBeenCalledWith(
      FIND_FILE_INPUTS_JS,
      "banner"
    );
  });

  it("passes null when parent_match is omitted (no filter)", async () => {
    const { page } = makePage({ inputs: [{ parentText: "X" }] });
    await uploadFileImpl(page, { path: "/tmp/x.png" });
    expect(page.evaluateHandle).toHaveBeenCalledWith(FIND_FILE_INPUTS_JS, null);
  });

  it("surfaces a parent_match-specific error message when filter empties the list", async () => {
    const { page } = makePage({ inputs: [] });
    await expect(
      uploadFileImpl(page, { path: "/tmp/x.png", parent_match: "watermark" })
    ).rejects.toThrow(/container text matches \/watermark\/i/);
  });
});

describe("uploadFileImpl: confirm button", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("clicks the confirm button when it appears and reports button_clicked", async () => {
    const { page } = makePage({
      inputs: [{ parentText: "Banner" }],
      buttonClicked: "Done",
    });

    const result = await uploadFileImpl(page, {
      path: "/tmp/b.png",
      confirm_button: "^(done|save)$",
    });

    expect(result.confirmed).toBe(true);
    expect(result.button_clicked).toBe("Done");
    expect(page.evaluate).toHaveBeenCalledWith(
      CLICK_BUTTON_BY_REGEX_JS,
      "^(done|save)$"
    );
  });

  it("times out cleanly when the confirm button never appears", async () => {
    const { page } = makePage({
      inputs: [{ parentText: "Banner" }],
      buttonClicked: null,
    });

    const promise = uploadFileImpl(page, {
      path: "/tmp/b.png",
      confirm_button: "^done$",
      confirm_timeout_ms: 1000,
    });

    // Drive the polling loop forward
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result.confirmed).toBe(false);
    expect(result.button_clicked).toBeUndefined();
  });

  it("does not poll when no confirm_button is configured", async () => {
    const { page } = makePage({
      inputs: [{ parentText: "Banner" }],
      buttonClicked: "ShouldNotMatter",
    });

    await uploadFileImpl(page, { path: "/tmp/b.png" });

    expect(page.evaluate).not.toHaveBeenCalled();
  });
});
