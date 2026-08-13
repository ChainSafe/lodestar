/** Internal status values the reconciler can assign. */
export type Status = "In Progress" | "Review Requested" | "Awaiting Author";

/** Internal status -> exact single-select option name on the board. */
export const STATUS_TO_LANE: Record<Status, string> = {
  "In Progress": "In Progress",
  "Review Requested": "Review Requested",
  "Awaiting Author": "Awaiting Author",
};

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
  /** Latest ready-for-review or reopened event; older review signals do not count. */
  reviewCycleStartedAt?: string;
  /** User-level pending review requests only — team requests are excluded upstream. */
  pendingUserRequests: PendingRequest[];
  /**
   * User-level request signals that have not been explicitly removed. Includes
   * completed requests because approvals with another reviewer pending are a no-op.
   */
  reviewRequestSignals: PendingRequest[];
  reviews: ReviewInfo[];
}
