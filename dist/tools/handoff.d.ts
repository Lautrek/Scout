/**
 * Injects a persistent banner in the live browser asking the user to take a
 * manual action. Returns only when the user clicks "Done" (or a timeout elapses).
 *
 * This is the human-in-the-loop escape hatch: verification prompts, CAPTCHAs,
 * MFA codes, consent dialogs — anything the agent can't automate.
 *
 * Survives page navigations by re-injecting the banner on framenavigated events
 * and polling localStorage as a fallback (persists across soft navigations).
 */
export declare function handoffTool(instruction: string, timeoutMs?: number): Promise<{
    completed: boolean;
    elapsed: number;
}>;
//# sourceMappingURL=handoff.d.ts.map