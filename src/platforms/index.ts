/**
 * Platform adapter registry.
 *
 * Import getAdapter("linkedin") to get the right adapter for a platform.
 * New platforms are added here — one import, one registry entry.
 */

import { PlatformAdapter } from "./types.js";
import { LinkedInAdapter } from "./linkedin.js";
import { XAdapter } from "./x.js";
import { MediumAdapter } from "./medium.js";

const adapters: Record<string, PlatformAdapter> = {
  linkedin: new LinkedInAdapter(),
  x: new XAdapter(),
  twitter: new XAdapter(), // alias
  medium: new MediumAdapter(),
};

export function getAdapter(platform: string): PlatformAdapter | null {
  return adapters[platform.toLowerCase()] ?? null;
}

export function listPlatforms(): string[] {
  // Deduplicate (twitter/x are the same adapter)
  return [...new Set(Object.keys(adapters))];
}

export { PlatformAdapter, LinkedInAdapter, XAdapter, MediumAdapter };
export type { Post, ComposeResult, PostResult } from "./types.js";
