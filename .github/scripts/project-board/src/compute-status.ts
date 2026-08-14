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

  const inCurrentCycle = (date: string): boolean =>
    pr.reviewCycleStartedAt === undefined || date >= pr.reviewCycleStartedAt;
  const counted = pr.reviews.filter((r) => r.fromUser && inCurrentCycle(r.submittedAt));
  const feedback = counted.filter((r) => r.state === "CHANGES_REQUESTED" || r.state === "COMMENTED");
  const newestFeedback = newest(feedback.map((r) => r.submittedAt));
  // Completed requests remain signals while another reviewer is pending so
  // that an approval preserves the lane selected by the preceding re-request.
  const newestRequest = pr.pendingUserRequests.length
    ? newest([
        ...pr.reviewRequestSignals.filter((r) => inCurrentCycle(r.requestedAt)).map((r) => r.requestedAt),
        ...pr.pendingUserRequests.map((r) =>
          pr.reviewCycleStartedAt !== undefined && r.requestedAt < pr.reviewCycleStartedAt
            ? pr.reviewCycleStartedAt
            : r.requestedAt,
        ),
      ])
    : undefined;

  // Latest signal wins; a request wins timestamp ties (re-request intent is explicit).
  if (newestRequest !== undefined && (newestFeedback === undefined || newestRequest >= newestFeedback)) {
    return "Review Requested";
  }
  if (newestFeedback !== undefined) return "Awaiting Author";
  if (counted.some((r) => r.state === "APPROVED")) return "Awaiting Author";
  return "In Progress";
}
