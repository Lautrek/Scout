export interface TabInfo {
    index: number;
    url: string;
    title: string;
    active: boolean;
}
export declare function tabsTool(): Promise<TabInfo[]>;
export declare function switchTabTool(index: number): Promise<TabInfo>;
export declare function newTabTool(url?: string): Promise<TabInfo>;
//# sourceMappingURL=tabs.d.ts.map