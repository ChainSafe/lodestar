/** Internal status values the reconciler can assign. */
export type Status = "In Progress" | "Review Requested" | "Awaiting Author";

/** Internal status -> exact single-select option name on the board. */
export const STATUS_TO_LANE: Record<Status, string> = {
  "In Progress": "In Progress",
  "Review Requested": "Review Ready/Requested",
  "Awaiting Author": "Awaiting Author",
};

/**
 * Lanes the SWEEP processes (event runs reassert status regardless of lane).
 * Cards with no status and cards parked in other lanes (Backlog, Ready, Done)
 * are skipped by the sweep; initial placement comes from the PR-opened event.
 */
export const SWEEP_LANES: ReadonlySet<string> = new Set(Object.values(STATUS_TO_LANE));

export interface ReviewInfo {
  authorLogin: string;
  /** true only for User-type authors; Bot-type (GitHub Apps) and deleted authors don't count. */
  fromUser: boolean;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submittedAt: string; // ISO 8601 UTC — lexicographic compare is chronological
}

export interface PendingRequest {
  login: string;
  /** Reconstructed from timeline ReviewRequestedEvents; epoch fallback if not found. */
  requestedAt: string;
}

export interface PrSnapshot {
  prState: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  /** User-level pending review requests only — team requests are excluded upstream. */
  pendingUserRequests: PendingRequest[];
  reviews: ReviewInfo[];
}
