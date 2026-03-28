/**
 * Platform adapter types — standardized interface for social platform automation.
 *
 * Each platform (LinkedIn, X, Medium, etc.) implements PlatformAdapter
 * with its own selectors, shadow DOM handling, and compose flow.
 * The agent calls adapter.compose(text) → adapter.submitPost() without
 * knowing the platform internals.
 */

import { Page } from "playwright";

export interface Post {
  /** Platform-specific post identifier (URL, data-id, etc.) */
  id: string;
  /** Post text content */
  text: string;
  /** Post URL on the platform */
  url: string;
  /** Author name */
  author: string;
  /** When the post was published */
  timestamp?: string;
  /** Engagement metrics */
  reactions?: number;
  comments?: number;
  reposts?: number;
}

export interface ComposeResult {
  /** Whether text was successfully entered */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

export interface PostResult {
  /** Whether the post was submitted */
  success: boolean;
  /** URL of the published post (if available) */
  url?: string;
  /** Error message if failed */
  error?: string;
}

export interface PlatformAdapter {
  /** Platform identifier (e.g. "linkedin", "x", "medium") */
  readonly name: string;

  /** Platform home URL */
  readonly homeUrl: string;

  // ── Auth ─────────────────────────────────────────────────────────────

  /** Check if the user is logged in on the current page. */
  isLoggedIn(page: Page): Promise<boolean>;

  // ── Read ─────────────────────────────────────────────────────────────

  /** Get the user's recent posts. */
  getMyPosts(page: Page, limit?: number): Promise<Post[]>;

  /** Search for posts by query. */
  searchPosts(page: Page, query: string, limit?: number): Promise<Post[]>;

  // ── Create ───────────────────────────────────────────────────────────

  /**
   * Open the compose editor and type text.
   * Handles opening the compose UI, clearing any existing content,
   * and typing the new text. Does NOT submit.
   */
  compose(page: Page, text: string): Promise<ComposeResult>;

  /**
   * Submit the current compose editor.
   * Must be called after compose(). Handles scrolling to the submit
   * button, clicking it, and waiting for confirmation.
   */
  submitPost(page: Page): Promise<PostResult>;

  // ── Update ───────────────────────────────────────────────────────────

  /** Edit an existing post's text. */
  editPost(page: Page, postId: string, newText: string): Promise<PostResult>;

  // ── Delete ───────────────────────────────────────────────────────────

  /** Delete a post. */
  deletePost(page: Page, postId: string): Promise<boolean>;
}
