import { describe, expect, it, vi } from "vitest";
import {
  buildDeepQueryScript,
  CLICK_BUTTON_BY_REGEX_JS,
  clickWhenEnabledImpl,
  deepQueryImpl,
} from "../../src/tools/dom_walk.js";

describe("buildDeepQueryScript", () => {
  it("embeds the predicate body as a JSON string literal", () => {
    const script = buildDeepQueryScript(
      "n.tagName === 'BUTTON' && /publish/i.test(n.innerText || '')"
    );
    expect(script).toMatch(/Function\('n', 'return \(' \+ predicateBody/);
    // The body must appear as a JSON-stringified literal at the call site
    expect(script).toContain(
      JSON.stringify(
        "n.tagName === 'BUTTON' && /publish/i.test(n.innerText || '')"
      )
    );
  });

  it("walks shadow DOM", () => {
    const script = buildDeepQueryScript("true");
    expect(script).toMatch(/n\.shadowRoot/);
    expect(script).toMatch(/walk\(document\)/);
  });

  it("respects the field list when serializing", () => {
    const script = buildDeepQueryScript("true", {
      fields: ["tagName", "id", "value"],
    });
    expect(script).toMatch(/"tagName"/);
    expect(script).toMatch(/"id"/);
    expect(script).toMatch(/"value": n\.value/);
  });

  it("caps innerText / textContent strings to keep payloads bounded", () => {
    const script = buildDeepQueryScript("true", {
      fields: ["innerText"],
    });
    expect(script).toMatch(/innerText \|\| ''\)\.slice\(0, 200\)/);
  });

  it("treats disabled and checked as booleans", () => {
    const script = buildDeepQueryScript("true", {
      fields: ["disabled", "checked"],
    });
    expect(script).toMatch(/!!n\.disabled/);
    expect(script).toMatch(/!!n\.checked/);
  });

  it("applies the limit when slicing results", () => {
    const script = buildDeepQueryScript("true", { limit: 3 });
    expect(script).toMatch(/const limit = 3/);
    expect(script).toMatch(/out\.slice\(0, limit\)/);
  });

  it("uses default limit=50 when not specified", () => {
    const script = buildDeepQueryScript("true");
    expect(script).toMatch(/const limit = 50/);
  });

  it("surrounds the predicate in a try/catch so a thrower doesn't kill the walk", () => {
    const script = buildDeepQueryScript("n.boom.kapow");
    expect(script).toMatch(/try \{ if \(predicate\(n\)\) out\.push\(n\); \} catch/);
  });
});

describe("CLICK_BUTTON_BY_REGEX_JS", () => {
  it("walks the shadow DOM", () => {
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/walk\(document\)/);
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/n\.shadowRoot/);
  });

  it("matches BUTTON, YTCP-BUTTON, TP-YT-PAPER-BUTTON, PAPER-BUTTON", () => {
    for (const tag of [
      "BUTTON",
      "YTCP-BUTTON",
      "TP-YT-PAPER-BUTTON",
      "PAPER-BUTTON",
    ]) {
      expect(CLICK_BUTTON_BY_REGEX_JS).toContain(tag);
    }
  });

  it("also accepts role=button elements", () => {
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/role'\) === 'button'/);
  });

  it("skips disabled and aria-disabled and offscreen buttons", () => {
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/!b\.disabled/);
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/aria-disabled/);
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/offsetParent/);
  });

  it("uses case-insensitive regex", () => {
    expect(CLICK_BUTTON_BY_REGEX_JS).toMatch(/RegExp\(pattern, 'i'\)/);
  });
});

describe("deepQueryImpl", () => {
  it("forwards the script string to page.evaluate and returns its result", async () => {
    const fakeRows = [{ tagName: "BUTTON", innerText: "Publish" }];
    const page = {
      evaluate: vi.fn(async (_script: string) => fakeRows),
    } as any;
    const result = await deepQueryImpl(page, {
      predicate: "n.tagName === 'BUTTON'",
    });
    expect(result).toEqual(fakeRows);
    expect(page.evaluate).toHaveBeenCalledOnce();
    const sentScript = page.evaluate.mock.calls[0][0] as string;
    expect(sentScript).toContain("'BUTTON'");
  });
});

describe("clickWhenEnabledImpl", () => {
  it("returns clicked=true with button_text on first hit", async () => {
    const page = {
      evaluate: vi.fn(async () => "Publish"),
    } as any;
    const result = await clickWhenEnabledImpl(page, {
      pattern: "^publish$",
      timeout_ms: 1000,
      poll_ms: 50,
    });
    expect(result.clicked).toBe(true);
    expect(result.button_text).toBe("Publish");
    expect(typeof result.waited_ms).toBe("number");
  });

  it("polls until the button becomes enabled, then clicks", async () => {
    let calls = 0;
    const page = {
      evaluate: vi.fn(async () => {
        calls += 1;
        return calls < 3 ? null : "Done";
      }),
    } as any;
    const result = await clickWhenEnabledImpl(page, {
      pattern: "^done$",
      timeout_ms: 5000,
      poll_ms: 10,
    });
    expect(result.clicked).toBe(true);
    expect(result.button_text).toBe("Done");
    expect(calls).toBe(3);
  });

  it("returns clicked=false on timeout without throwing", async () => {
    const page = {
      evaluate: vi.fn(async () => null),
    } as any;
    const result = await clickWhenEnabledImpl(page, {
      pattern: "^never$",
      timeout_ms: 50,
      poll_ms: 10,
    });
    expect(result.clicked).toBe(false);
    expect(result.button_text).toBeUndefined();
    expect(result.waited_ms).toBeGreaterThanOrEqual(50);
  });

  it("forwards the pattern to page.evaluate as the second arg", async () => {
    const page = {
      evaluate: vi.fn(async () => "Save"),
    } as any;
    await clickWhenEnabledImpl(page, { pattern: "^(done|save)$" });
    expect(page.evaluate).toHaveBeenCalledWith(
      CLICK_BUTTON_BY_REGEX_JS,
      "^(done|save)$"
    );
  });
});
