import type {PrNode} from "./snapshot.ts";
import {SWEEP_LANES} from "./types.ts";

const API = "https://api.github.com/graphql";

export async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: {authorization: `bearer ${token}`, "content-type": "application/json"},
    body: JSON.stringify({query, variables}),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {data?: T; errors?: unknown[]};
  if (body.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  if (!body.data) throw new Error("GraphQL response had no data");
  return body.data;
}

export interface ProjectConfig {
  projectId: string;
  statusFieldId: string;
  /** exact lane name -> single-select option id */
  optionIds: Map<string, string>;
}

const PROJECT_QUERY = `
query ($org: String!, $number: Int!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes {
          ... on ProjectV2SingleSelectField { id name options { id name } }
        }
      }
    }
  }
}`;

export async function resolveProjectConfig(token: string, org: string, number: number): Promise<ProjectConfig> {
  type Res = {
    organization: {
      projectV2: {
        id: string;
        fields: {nodes: Array<{id?: string; name?: string; options?: Array<{id: string; name: string}>}>};
      } | null;
    } | null;
  };
  const data = await gql<Res>(token, PROJECT_QUERY, {org, number});
  if (!data.organization) throw new Error(`organization "${org}" not found or token lacks access`);
  const project = data.organization.projectV2;
  if (!project) throw new Error(`project ${org}#${number} not found or token lacks Projects access`);
  const status = project.fields.nodes.find((f) => f.name === "Status");
  if (!status?.id || !status.options) throw new Error(`project ${org}#${number} has no single-select "Status" field`);
  return {
    projectId: project.id,
    statusFieldId: status.id,
    optionIds: new Map(status.options.map((o) => [o.name, o.id])),
  };
}

// Selection set must stay in sync with PrNode in snapshot.ts.
// `last:` windows: newest 100 reviews / request events are what the Model's
// "latest signal wins" comparison needs; older history is irrelevant except
// for pathological PRs (logged via the epoch fallback in snapshot.ts).
const PR_QUERY = `
query ($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      state
      isDraft
      reviewRequests(first: 100) {
        nodes { requestedReviewer { __typename ... on User { login } } }
      }
      reviews(last: 100) {
        nodes { state submittedAt author { __typename login } }
      }
      timelineItems(
        last: 100
        itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, READY_FOR_REVIEW_EVENT, REOPENED_EVENT]
      ) {
        nodes {
          __typename
          ... on ReviewRequestedEvent {
            createdAt
            requestedReviewer { __typename ... on User { login } }
          }
          ... on ReviewRequestRemovedEvent {
            createdAt
            requestedReviewer { __typename ... on User { login } }
          }
          ... on ReadyForReviewEvent { createdAt }
          ... on ReopenedEvent { createdAt }
        }
      }
      projectItems(first: 20) {
        nodes {
          id
          project { number }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }
  }
}`;

export async function fetchPr(token: string, owner: string, repo: string, number: number): Promise<PrNode | null> {
  type Res = {repository: {pullRequest: PrNode | null} | null};
  const data = await gql<Res>(token, PR_QUERY, {owner, repo, number});
  return data.repository?.pullRequest ?? null;
}

const UPDATE_MUTATION = `
mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: {projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: {singleSelectOptionId: $optionId}}
  ) { projectV2Item { id } }
}`;

export async function updateItemLane(token: string, cfg: ProjectConfig, itemId: string, lane: string): Promise<void> {
  const optionId = cfg.optionIds.get(lane);
  if (!optionId) {
    throw new Error(`board has no "${lane}" option; found: ${[...cfg.optionIds.keys()].join(", ")}`);
  }
  await gql(token, UPDATE_MUTATION, {projectId: cfg.projectId, itemId, fieldId: cfg.statusFieldId, optionId});
}

const ADD_ITEM_MUTATION = `
mutation ($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) { item { id } }
}`;

/** Idempotent with the board's built-in auto-add: returns the existing item if already on the board. */
export async function addPrToBoard(token: string, projectId: string, contentId: string): Promise<string> {
  type Res = {addProjectV2ItemById: {item: {id: string}}};
  const data = await gql<Res>(token, ADD_ITEM_MUTATION, {projectId, contentId});
  return data.addProjectV2ItemById.item.id;
}

const SWEEP_QUERY = `
query ($org: String!, $number: Int!, $cursor: String) {
  organization(login: $org) {
    projectV2(number: $number) {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          content {
            __typename
            ... on PullRequest { number state repository { name owner { login } } }
          }
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }
  }
}`;

export interface BoardPr {
  owner: string;
  repo: string;
  number: number;
}

/**
 * All OPEN pull requests whose card sits in one of the sweep lanes. Statusless
 * cards and cards parked in Backlog/Ready/Done are never touched by the sweep
 * and are dropped here, so the sweep never even fetches their PR detail. Event
 * runs own initial placement (adding the card if needed) and card-adding —
 * they bypass this listing entirely and reassert status regardless of lane.
 */
export async function listOpenBoardPrs(token: string, org: string, projectNumber: number): Promise<BoardPr[]> {
  type Item = {
    content: {
      __typename: string;
      number?: number;
      state?: string;
      repository?: {name: string; owner: {login: string}};
    } | null;
    fieldValueByName: {name: string} | null;
  };
  type Res = {
    organization: {
      projectV2: {items: {pageInfo: {hasNextPage: boolean; endCursor: string | null}; nodes: Item[]}};
    };
  };
  const prs: BoardPr[] = [];
  let cursor: string | null = null;
  do {
    const data: Res = await gql<Res>(token, SWEEP_QUERY, {org, number: projectNumber, cursor});
    const page = data.organization.projectV2.items;
    for (const item of page.nodes) {
      const c = item.content;
      const lane = item.fieldValueByName?.name ?? null;
      const owned = lane !== null && SWEEP_LANES.has(lane);
      if (owned && c?.__typename === "PullRequest" && c.state === "OPEN" && c.repository && c.number !== undefined) {
        prs.push({owner: c.repository.owner.login, repo: c.repository.name, number: c.number});
      }
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return prs;
}
