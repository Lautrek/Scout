export interface LoginResult {
    success: boolean;
    url: string;
    challenge_type?: string;
    error?: string;
}
/**
 * High-level login tool. Navigates to the platform login page and drives
 * the login flow automatically using React-safe keyboard input.
 *
 * Handles:
 * - Standard username/password two-step flows (Twitter/X style)
 * - "Unusual login activity" username confirmation challenges
 * - Unknown challenges: injects a handoff banner for human intervention
 *
 * Supported platforms: twitter, linkedin, instagram, facebook
 */
export declare function loginTool(platform: string, username: string, password: string): Promise<LoginResult>;
//# sourceMappingURL=login.d.ts.map