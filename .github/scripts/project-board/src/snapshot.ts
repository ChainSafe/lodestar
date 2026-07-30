import type {PendingRequest, PrSnapshot, ReviewInfo} from "./types.ts";

interface Actor {
  __typename: string;
  login?: string;
}

/** Shape produced by PR_QUERY in github.ts — keep the two in sync. */
export interface PrNode {
  /** GraphQL node ID; used as contentId for addProjectV2ItemById. */
  id: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  reviewRequests: {nodes: Array<{requestedReviewer: Actor | null}>};
  reviews: {nodes: Array<{state: ReviewInfo["state"]; submittedAt: string | null; author: Actor | null}>};
  /** REVIEW_REQUESTED_EVENT only, newest last (query uses `last:`). */
  timelineItems: {nodes: Array<{createdAt: string; requestedReviewer: Actor | null}>};
  projectItems: {
    nodes: Array<{id: string; project: {number: number}; fieldValueByName: {name: string} | null}>;
  };
}

const EPOCH = "1970-01-01T00:00:00Z";

export function buildSnapshot(pr: PrNode): PrSnapshot {
  const pendingUserRequests: PendingRequest[] = pr.reviewRequests.nodes
    .filter((n) => n.requestedReviewer?.__typename === "User" && n.requestedReviewer.login)
    .map((n) => {
      const login = n.requestedReviewer?.login as string;
      const events = pr.timelineItems.nodes.filter(
        (e) => e.requestedReviewer?.__typename === "User" && e.requestedReviewer.login === login,
      );
      const requestedAt = events.length ? events[events.length - 1].createdAt : EPOCH;
      if (requestedAt === EPOCH) {
        console.warn(`no ReviewRequestedEvent found for pending request from ${login}; using epoch fallback`);
      }
      return {login, requestedAt};
    });

  const reviews: ReviewInfo[] = pr.reviews.nodes
    .filter((n) => n.submittedAt !== null)
    .map((n) => ({
      authorLogin: n.author?.login ?? "(deleted)",
      fromUser: n.author?.__typename === "User",
      state: n.state,
      submittedAt: n.submittedAt as string,
    }));

  return {prState: pr.state, isDraft: pr.isDraft, pendingUserRequests, reviews};
}

export function pickProjectItem(
  pr: PrNode,
  projectNumber: number,
): {itemId: string; currentLane: string | null} | null {
  const item = pr.projectItems.nodes.find((n) => n.project.number === projectNumber);
  if (!item) return null;
  return {itemId: item.id, currentLane: item.fieldValueByName?.name ?? null};
}
