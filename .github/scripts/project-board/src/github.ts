import type {PrNode} from "./snapshot.ts";

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

export const TRUNCATED_CONNECTION_ERROR_CODE = "PROJECT_BOARD_GRAPHQL_CONNECTION_TRUNCATED";

export class TruncatedConnectionError extends Error {
  readonly code = TRUNCATED_CONNECTION_ERROR_CODE;
  readonly metadata: {resource: string; connection: string};

  constructor(resource: string, connection: string) {
    const metadata = {resource, connection};
    super(`${TRUNCATED_CONNECTION_ERROR_CODE}: refusing to reconcile incomplete data; context=${JSON.stringify(metadata)}`);
    this.name = "TruncatedConnectionError";
    this.metadata = metadata;
  }
}

export function assertConnectionComplete(
  resource: string,
  connection: string,
  pageInfo: {hasNextPage?: boolean; hasPreviousPage?: boolean},
): void {
  if (pageInfo.hasNextPage || pageInfo.hasPreviousPage) {
    throw new TruncatedConnectionError(resource, connection);
  }
}

const PROJECT_QUERY = `
query ($org: String!, $number: Int!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        pageInfo { hasNextPage }
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
        fields: {
          pageInfo: {hasNextPage: boolean};
          nodes: Array<{id?: string; name?: string; options?: Array<{id: string; name: string}>}>;
        };
      } | null;
    } | null;
  };
  const data = await gql<Res>(token, PROJECT_QUERY, {org, number});
  if (!data.organization) throw new Error(`organization "${org}" not found or token lacks access`);
  const project = data.organization.projectV2;
  if (!project) throw new Error(`project ${org}#${number} not found or token lacks Projects access`);
  assertConnectionComplete(`${org} project #${number}`, "fields", project.fields.pageInfo);
  const status = project.fields.nodes.find((f) => f.name === "Status");
  if (!status?.id || !status.options) throw new Error(`project ${org}#${number} has no single-select "Status" field`);
  return {
    projectId: project.id,
    statusFieldId: status.id,
    optionIds: new Map(status.options.map((o) => [o.name, o.id])),
  };
}

// Selection set must stay in sync with PrNode in snapshot.ts.
// Fixed windows are guarded by pageInfo. Refuse to compute from truncated data
// instead of silently producing a potentially incorrect lane.
const PR_QUERY = `
query ($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      state
      isDraft
      reviewRequests(first: 100) {
        pageInfo { hasNextPage }
        nodes { requestedReviewer { __typename ... on User { login } } }
      }
      reviews(last: 100) {
        pageInfo { hasPreviousPage }
        nodes { state submittedAt author { __typename login } }
      }
      timelineItems(
        last: 100
        itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, READY_FOR_REVIEW_EVENT, REOPENED_EVENT]
      ) {
        pageInfo { hasPreviousPage }
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
        pageInfo { hasNextPage }
        nodes {
          id
          project { id number }
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
  const pr = data.repository?.pullRequest ?? null;
  if (!pr) return null;

  const resource = `${owner}/${repo}#${number}`;
  assertConnectionComplete(resource, "reviewRequests", pr.reviewRequests.pageInfo);
  assertConnectionComplete(resource, "reviews", pr.reviews.pageInfo);
  assertConnectionComplete(resource, "timelineItems", pr.timelineItems.pageInfo);
  assertConnectionComplete(resource, "projectItems", pr.projectItems.pageInfo);
  return pr;
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

/** All OPEN pull request cards on the board, regardless of their current lane. */
export async function listOpenBoardPrs(token: string, org: string, projectNumber: number): Promise<BoardPr[]> {
  type Item = {
    content: {
      __typename: string;
      number?: number;
      state?: string;
      repository?: {name: string; owner: {login: string}};
    } | null;
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
      if (c?.__typename === "PullRequest" && c.state === "OPEN" && c.repository && c.number !== undefined) {
        prs.push({owner: c.repository.owner.login, repo: c.repository.name, number: c.number});
      }
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return prs;
}
