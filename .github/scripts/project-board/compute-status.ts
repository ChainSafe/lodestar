import type {PrSnapshot, Status} from "./types.ts";

function newest(dates: string[]): string | undefined {
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : undefined;
}

/**
 * Spec: .github/specs/project-automation.md, "Model" section.
 * Returns null when the reconciler must not touch the card
 * (merged/closed — the board's built-in workflows own Done).
 */
export function computeStatus(pr: PrSnapshot): Status | null {
  if (pr.prState !== "OPEN") return null;
  if (pr.isDraft) return "In Progress";

  const counted = pr.reviews.filter((r) => r.fromUser);
  const feedback = counted.filter((r) => r.state === "CHANGES_REQUESTED" || r.state === "COMMENTED");
  const newestFeedback = newest(feedback.map((r) => r.submittedAt));
  const newestRequest = newest(pr.pendingUserRequests.map((r) => r.requestedAt));

  // Latest signal wins; a request wins timestamp ties (re-request intent is explicit).
  if (newestRequest !== undefined && (newestFeedback === undefined || newestRequest >= newestFeedback)) {
    return "Review Requested";
  }
  if (newestFeedback !== undefined) return "Awaiting Author";
  if (counted.some((r) => r.state === "APPROVED")) return "Awaiting Author";
  return "In Progress";
}
