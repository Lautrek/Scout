export type HandoffStatus = "pending" | "completed" | "expired" | "cancelled";
/**
 * Inject a banner in the live browser asking the user to take a manual action.
 * Returns IMMEDIATELY with a handoff_id and status "pending".
 *
 * Use scout_handoff_check(handoff_id) to poll until status is "completed".
 * This avoids the ~30s MCP tool call timeout.
 *
 * When to use: CAPTCHAs, SMS/email verification codes, authenticator app prompts,
 * consent dialogs — anything that requires a human and can't be automated.
 *
 * Typical flow:
 *   scout_handoff("Enter the 2FA code then click Done") → {handoff_id: "abc", status: "pending"}
 *   scout_handoff_check("abc") → {status: "pending", elapsed_s: 8}
 *   scout_handoff_check("abc") → {status: "completed", elapsed_s: 21}
 */
export declare function handoffTool(instruction: string, timeoutMs?: number): Promise<{
    handoff_id: string;
    status: HandoffStatus;
    message: string;
}>;
/**
 * Check the status of a pending handoff.
 * Returns immediately. Poll this every 5-10 seconds after calling scout_handoff.
 */
export declare function checkHandoff(handoff_id: string): {
    status: HandoffStatus;
    elapsed_s: number;
    instruction?: string;
    message: string;
};
/**
 * Cancel a pending handoff and remove the banner.
 */
export declare function cancelHandoff(handoff_id: string): Promise<{
    cancelled: boolean;
}>;
//# sourceMappingURL=handoff.d.ts.map