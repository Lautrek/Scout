export interface ScoutElement {
  id: number;
  role: string;
  label: string;
  placeholder?: string;
  value?: string;
  enabled: boolean;
  visible: boolean;
  checked?: boolean;
  description?: string;
}

export interface SnapshotResult {
  url: string;
  title: string;
  timestamp: string;
  elements: ScoutElement[];
  markdown: string;
  screenshot?: string; // base64 PNG
}

export interface HealerState {
  url: string;
  title: string;
  elementCount: number;
  bodyHash: string;
}

export type StateChange = "navigation" | "modal" | "dom_change" | "none";

export interface HealerResult {
  stateChange: StateChange;
  before: HealerState;
  after: HealerState;
}
