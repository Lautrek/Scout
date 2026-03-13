export interface LoginResult {
    success: boolean;
    url: string;
    challenge_type?: string;
    handoff_id?: string;
    error?: string;
}
/**
 * High-level login tool. Drives the full login flow automatically.
 *
 * Handles automatically:
 * - Standard username/password two-step flows (Twitter/X style)
 * - "Unusual login activity" username confirmation (enter your username/phone/email again)
 * - "Confirm your identity" screens with a fillable input
 *
 * Returns handoff_id (non-blocking) for challenges requiring human:
 * - CAPTCHA images
 * - SMS code sent to phone
 * - Authenticator app TOTP
 * - Email verification code
 *
 * When handoff_id is returned: poll scout_handoff_check(handoff_id) until
 * status is "completed", then call scout_login again or verify with scout_snapshot.
 *
 * Credential formats:
 *   twitter  → username (not email)
 *   linkedin → email
 *   instagram → email
 *   facebook → email
 */
export declare function loginTool(platform: string, username: string, password: string): Promise<LoginResult>;
//# sourceMappingURL=login.d.ts.map