import { Page } from "playwright";
import { ScoutElement } from "../types.js";
export declare function getElement(id: number): ScoutElement | undefined;
export declare function setLastElements(elements: ScoutElement[]): void;
export declare function clearElements(): void;
export declare function extractA11yElements(page: Page): Promise<ScoutElement[]>;
export declare function buildMarkdown(url: string, title: string, elements: ScoutElement[]): string;
//# sourceMappingURL=a11y.d.ts.map