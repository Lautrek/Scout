/**
 * Platform adapter registry.
 *
 * Import getAdapter("linkedin") to get the right adapter for a platform.
 * New platforms are added here — one import, one registry entry.
 */

import type { PlatformAdapter } from "./types.js";
import { LinkedInAdapter } from "./linkedin.js";
import { XAdapter } from "./x.js";
import { MediumAdapter } from "./medium.js";

const adapters: Record<string, PlatformAdapter> = {
  linkedin: new LinkedInAdapter() as any,
  x: new XAdapter() as any,
  twitter: new XAdapter() as any, // alias
  medium: new MediumAdapter() as any,
};

export function getAdapter(platform: string): PlatformAdapter | null {
  return adapters[platform.toLowerCase()] ?? null;
}

export function listPlatforms(): string[] {
  // Deduplicate (twitter/x are the same adapter)
  return [...new Set(Object.keys(adapters))];
}

export { LinkedInAdapter, XAdapter, MediumAdapter };
export type { PlatformAdapter, Post, ComposeResult, PostResult } from "./types.js";
