import { Page } from "playwright";
import { HealerState, HealerResult } from "../types.js";
export declare function captureState(page: Page): Promise<HealerState>;
export declare function healerWrap(page: Page, action: () => Promise<void>): Promise<HealerResult>;
//# sourceMappingURL=healer.d.ts.map