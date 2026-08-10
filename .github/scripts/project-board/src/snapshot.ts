import type {PendingRequest, PrSnapshot, ReviewInfo} from "./types.ts";

interface Actor {
  __typename: string;
  login?: string;
}

/** Shape produced by PR_QUERY in github.ts — keep the two in sync. */
export interface PrNode {
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  reviewRequests: {nodes: Array<{requestedReviewer: Actor | null}>};
  reviews: {nodes: Array<{state: ReviewInfo["state"]; submittedAt: string | null; author: Actor | null}>};
  /** Review request and lifecycle events, newest last (query uses `last:`). */
  timelineItems: {
    nodes: Array<
      | {
          __typename: "ReviewRequestedEvent" | "ReviewRequestRemovedEvent";
          createdAt: string;
          requestedReviewer: Actor | null;
        }
      | {__typename: "ReadyForReviewEvent" | "ReopenedEvent"; createdAt: string}
    >;
  };
  projectItems: {
    nodes: Array<{id: string; project: {id: string; number: number}; fieldValueByName: {name: string} | null}>;
  };
}

const EPOCH = "1970-01-01T00:00:00Z";

export function buildSnapshot(pr: PrNode): PrSnapshot {
  // GitHub removes a request from reviewRequests when the reviewer responds,
  // but emits ReviewRequestRemovedEvent only for an explicit removal. Retain
  // completed request signals and pop only explicitly removed requests.
  const requestStacks = new Map<string, PendingRequest[]>();
  let reviewCycleStartedAt: string | undefined;
  for (const event of pr.timelineItems.nodes) {
    if (!("requestedReviewer" in event)) {
      if (reviewCycleStartedAt === undefined || event.createdAt > reviewCycleStartedAt) {
        reviewCycleStartedAt = event.createdAt;
      }
      continue;
    }

    const reviewer = event.requestedReviewer;
    if (reviewer?.__typename !== "User" || !reviewer.login) continue;

    const stack = requestStacks.get(reviewer.login) ?? [];
    if (event.__typename === "ReviewRequestedEvent") {
      stack.push({login: reviewer.login, requestedAt: event.createdAt});
      requestStacks.set(reviewer.login, stack);
    } else {
      stack.pop();
    }
  }

  const pendingUserRequests: PendingRequest[] = pr.reviewRequests.nodes
    .filter((n) => n.requestedReviewer?.__typename === "User" && n.requestedReviewer.login)
    .map((n) => {
      const login = n.requestedReviewer?.login as string;
      const requestedAt = requestStacks.get(login)?.at(-1)?.requestedAt ?? EPOCH;
      if (requestedAt === EPOCH) {
        console.warn(`no ReviewRequestedEvent found for pending request from ${login}; using epoch fallback`);
        requestStacks.set(login, [{login, requestedAt}]);
      }
      return {login, requestedAt};
    });

  const reviewRequestSignals = [...requestStacks.values()].flatMap((stack) => stack.slice(-1));

  const reviews: ReviewInfo[] = pr.reviews.nodes
    .filter((n) => n.submittedAt !== null)
    .map((n) => ({
      authorLogin: n.author?.login ?? "(deleted)",
      fromUser: n.author?.__typename === "User",
      state: n.state,
      submittedAt: n.submittedAt as string,
    }));

  return {
    prState: pr.state,
    isDraft: pr.isDraft,
    reviewCycleStartedAt,
    pendingUserRequests,
    reviewRequestSignals,
    reviews,
  };
}

export function pickProjectItem(
  pr: PrNode,
  projectId: string,
): {itemId: string; currentLane: string | null} | null {
  const item = pr.projectItems.nodes.find((n) => n.project.id === projectId);
  if (!item) return null;
  return {itemId: item.id, currentLane: item.fieldValueByName?.name ?? null};
}
