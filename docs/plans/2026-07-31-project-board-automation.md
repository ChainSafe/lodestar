# Project Board Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate PR card Status transitions on ChainSafe org project #75 per `.github/specs/project-automation.md`.

**Architecture:** A dependency-free TypeScript reconciler (run directly by Node 24 type stripping) recomputes a PR's correct lane from its full state and writes it via the Projects v2 GraphQL API. One reusable GitHub workflow in lodestar carries both `workflow_call` (entry for accessory repos) and its own `pull_request_target` / `pull_request_review` / `schedule` triggers. A 15-minute sweep in lodestar reconciles every open PR card on the whole board.

**Tech Stack:** TypeScript (erasable syntax only), Node 24 built-in `node:test` + `node:util` `parseArgs` + `fetch`, GitHub Actions, GitHub GraphQL API.

## Global Constraints

- Spec is authoritative: `.github/specs/project-automation.md`. Any behavior change lands there first.
- Node 24, type stripping: no `enum`, no runtime `namespace`, no parameter properties; relative imports use the literal `.ts` extension (Node does not remap extensions).
- Zero npm dependencies for the script; only `node:` built-ins and global `fetch`.
- The automation only writes the Status field of PR cards on project #75. It never modifies PRs, never adds cards to the board.
- Board lane names (exact): `In Progress`, `Review Requested`, `Awaiting Author`. Resolve field/option IDs at runtime by name; fail loudly if a name is missing.
- Only **user-level** review requests count; team requests are ignored. Only reviews from **User-type** authors count; Bot-type (GitHub App) reviews are ignored. Deleted-author reviews are ignored.
- Token: `PROJECT_BOARD_TOKEN` secret (fine-grained PAT, org Projects read/write + public repo read). Missing token must exit 0 with a warning (fork-PR `pull_request_review` runs have no secrets).
- Commit style: Conventional Commits, no Co-Authored-By lines.
- New files live in `.github/scripts/project-board/` and `.github/workflows/project-board.yml` — they are NOT part of the pnpm monorepo build; do not wire them into any package.

## File Structure

```text
.github/
  workflows/project-board.yml            # reusable + self-triggering workflow (Task 4)
  specs/project-board-caller.yml         # template callers copy into accessory repos (Task 4)
  scripts/project-board/
    tsconfig.json                        # type-check config, erasableSyntaxOnly (Task 1)
    types.ts                             # shared types + lane-name mapping (Task 1)
    compute-status.ts                    # pure computeStatus() — the spec's Model section (Task 1)
    compute-status.test.ts               # node:test unit tests (Task 1)
    snapshot.ts                          # pure GraphQL-JSON → PrSnapshot assembly (Task 2)
    snapshot.test.ts                     # node:test unit tests (Task 2)
    github.ts                            # GraphQL I/O: queries, config resolution, mutation (Task 3)
    main.ts                              # entrypoint: event mode / sweep mode / dry-run (Task 3)
```

---

### Task 1: Pure domain — types and `computeStatus()`

**Files:**
- Create: `.github/scripts/project-board/tsconfig.json`
- Create: `.github/scripts/project-board/types.ts`
- Create: `.github/scripts/project-board/compute-status.ts`
- Test: `.github/scripts/project-board/compute-status.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeStatus(pr: PrSnapshot): Status | null` (null = do not touch the card; merged/closed is owned by the board's built-in workflows). Types `Status`, `PrSnapshot`, `ReviewInfo`, `PendingRequest`, and `STATUS_TO_LANE` (internal status → exact board lane name) used by Tasks 2–3.

- [ ] **Step 1: Verify toolchain**

Run: `node --version && pnpm exec tsc --version`
Expected: Node ≥ 24, tsc ≥ 5.8 (needed for `erasableSyntaxOnly`). If tsc < 5.8, drop `erasableSyntaxOnly` from tsconfig and rely on runtime stripping errors.

- [ ] **Step 2: Write tsconfig and types**

`.github/scripts/project-board/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

`.github/scripts/project-board/types.ts`:

```ts
/** Internal status values the reconciler can assign. */
export type Status = "In Progress" | "Review Requested" | "Awaiting Author";

/** Internal status -> exact single-select option name on the board. */
export const STATUS_TO_LANE: Record<Status, string> = {
  "In Progress": "In Progress",
  "Review Requested": "Review Requested",
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
```

- [ ] **Step 3: Write the failing tests**

`.github/scripts/project-board/compute-status.test.ts`:

```ts
import assert from "node:assert/strict";
import {test} from "node:test";
import {computeStatus} from "./compute-status.ts";
import type {PrSnapshot, ReviewInfo} from "./types.ts";

function pr(overrides: Partial<PrSnapshot>): PrSnapshot {
  return {prState: "OPEN", isDraft: false, pendingUserRequests: [], reviews: [], ...overrides};
}

function review(overrides: Partial<ReviewInfo>): ReviewInfo {
  return {authorLogin: "alice", fromUser: true, state: "COMMENTED", submittedAt: "2026-01-02T00:00:00Z", ...overrides};
}

test("merged and closed PRs are not touched (built-in workflow owns Done)", () => {
  assert.equal(computeStatus(pr({prState: "MERGED"})), null);
  assert.equal(computeStatus(pr({prState: "CLOSED"})), null);
});

test("draft is In Progress even with pending requests", () => {
  const p = pr({isDraft: true, pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}]});
  assert.equal(computeStatus(p), "In Progress");
});

test("open non-draft with no signals is In Progress", () => {
  assert.equal(computeStatus(pr({})), "In Progress");
});

test("pending user request with no reviews is Review Requested", () => {
  const p = pr({pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}]});
  assert.equal(computeStatus(p), "Review Requested");
});

test("comment review newer than request is Awaiting Author (even with request pending)", () => {
  const p = pr({
    pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}],
    reviews: [review({submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Awaiting Author");
});

test("drive-by comment review with no request pending is Awaiting Author", () => {
  assert.equal(computeStatus(pr({reviews: [review({})]})), "Awaiting Author");
});

test("changes_requested behaves like commented", () => {
  const p = pr({
    pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}],
    reviews: [review({state: "CHANGES_REQUESTED", submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Awaiting Author");
});

test("re-request newer than feedback flips back to Review Requested", () => {
  const p = pr({
    pendingUserRequests: [{login: "alice", requestedAt: "2026-01-03T00:00:00Z"}],
    reviews: [review({submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Review Requested");
});

test("timestamp tie between request and feedback: request wins", () => {
  const p = pr({
    pendingUserRequests: [{login: "alice", requestedAt: "2026-01-02T00:00:00Z"}],
    reviews: [review({submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Review Requested");
});

test("bot reviews are invisible", () => {
  const p = pr({
    pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}],
    reviews: [review({authorLogin: "codex[bot]", fromUser: false, submittedAt: "2026-01-05T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Review Requested");
});

test("approval with another request still pending stays Review Requested", () => {
  const p = pr({
    pendingUserRequests: [{login: "bob", requestedAt: "2026-01-01T00:00:00Z"}],
    reviews: [review({state: "APPROVED", submittedAt: "2026-01-02T00:00:00Z"})],
  });
  assert.equal(computeStatus(p), "Review Requested");
});

test("approval with no pending requests is Awaiting Author (merge me)", () => {
  const p = pr({reviews: [review({state: "APPROVED"})]});
  assert.equal(computeStatus(p), "Awaiting Author");
});

test("dismissed feedback does not count", () => {
  const p = pr({reviews: [review({state: "DISMISSED"})]});
  assert.equal(computeStatus(p), "In Progress");
});

test("pending (unsubmitted) reviews do not count", () => {
  const p = pr({reviews: [review({state: "PENDING"})]});
  assert.equal(computeStatus(p), "In Progress");
});

test("request removed scenario: lingering feedback with no pending requests is Awaiting Author", () => {
  const p = pr({reviews: [review({submittedAt: "2026-01-02T00:00:00Z"})]});
  assert.equal(computeStatus(p), "Awaiting Author");
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `node --test .github/scripts/project-board/compute-status.test.ts`
Expected: FAIL — cannot find module `./compute-status.ts`.

- [ ] **Step 5: Implement `computeStatus`**

`.github/scripts/project-board/compute-status.ts`:

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test .github/scripts/project-board/compute-status.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 7: Type-check**

Run: `pnpm exec tsc -p .github/scripts/project-board/tsconfig.json`
Expected: exits 0, no output.

- [ ] **Step 8: Commit**

```bash
git add .github/scripts/project-board/
git commit -m "feat: add project board status reconciler core"
```

---

### Task 2: Snapshot assembly from GraphQL JSON

**Files:**
- Create: `.github/scripts/project-board/snapshot.ts`
- Test: `.github/scripts/project-board/snapshot.test.ts`

**Interfaces:**
- Consumes: `PrSnapshot`, `ReviewInfo`, `PendingRequest` from `./types.ts`.
- Produces:
  - `buildSnapshot(prNode: PrNode): PrSnapshot`
  - `pickProjectItem(prNode: PrNode, projectNumber: number): {itemId: string; currentLane: string | null} | null`
  - `interface PrNode` — the exact shape returned by Task 3's `PR_QUERY` (fields listed in the code below). Task 3 must select every field `PrNode` declares.

- [ ] **Step 1: Write the failing tests**

`.github/scripts/project-board/snapshot.test.ts`:

```ts
import assert from "node:assert/strict";
import {test} from "node:test";
import {buildSnapshot, pickProjectItem, type PrNode} from "./snapshot.ts";

function prNode(overrides: Partial<PrNode>): PrNode {
  return {
    state: "OPEN",
    isDraft: false,
    reviewRequests: {nodes: []},
    reviews: {nodes: []},
    timelineItems: {nodes: []},
    projectItems: {nodes: []},
    ...overrides,
  };
}

test("team review requests are excluded; user requests get timeline timestamps", () => {
  const node = prNode({
    reviewRequests: {
      nodes: [
        {requestedReviewer: {__typename: "Team", login: undefined}},
        {requestedReviewer: {__typename: "User", login: "alice"}},
      ],
    },
    timelineItems: {
      nodes: [
        {createdAt: "2026-01-01T00:00:00Z", requestedReviewer: {__typename: "User", login: "alice"}},
        {createdAt: "2026-01-03T00:00:00Z", requestedReviewer: {__typename: "User", login: "alice"}},
        {createdAt: "2026-01-04T00:00:00Z", requestedReviewer: {__typename: "Team", login: undefined}},
      ],
    },
  });
  const snap = buildSnapshot(node);
  assert.deepEqual(snap.pendingUserRequests, [{login: "alice", requestedAt: "2026-01-03T00:00:00Z"}]);
});

test("pending request with no timeline event falls back to epoch", () => {
  const node = prNode({
    reviewRequests: {nodes: [{requestedReviewer: {__typename: "User", login: "alice"}}]},
  });
  const snap = buildSnapshot(node);
  assert.deepEqual(snap.pendingUserRequests, [{login: "alice", requestedAt: "1970-01-01T00:00:00Z"}]);
});

test("bot and deleted review authors are marked fromUser=false", () => {
  const node = prNode({
    reviews: {
      nodes: [
        {state: "COMMENTED", submittedAt: "2026-01-01T00:00:00Z", author: {__typename: "Bot", login: "codex"}},
        {state: "COMMENTED", submittedAt: "2026-01-02T00:00:00Z", author: null},
        {state: "APPROVED", submittedAt: "2026-01-03T00:00:00Z", author: {__typename: "User", login: "bob"}},
      ],
    },
  });
  const snap = buildSnapshot(node);
  assert.deepEqual(snap.reviews.map((r) => r.fromUser), [false, false, true]);
});

test("reviews without submittedAt are dropped", () => {
  const node = prNode({
    reviews: {nodes: [{state: "PENDING", submittedAt: null, author: {__typename: "User", login: "bob"}}]},
  });
  assert.equal(buildSnapshot(node).reviews.length, 0);
});

test("pickProjectItem filters by project number and reads the current lane", () => {
  const node = prNode({
    projectItems: {
      nodes: [
        {id: "ITEM_OTHER", project: {number: 12}, fieldValueByName: {name: "Done"}},
        {id: "ITEM_75", project: {number: 75}, fieldValueByName: {name: "In Progress"}},
      ],
    },
  });
  assert.deepEqual(pickProjectItem(node, 75), {itemId: "ITEM_75", currentLane: "In Progress"});
  assert.equal(pickProjectItem(node, 99), null);
});

test("pickProjectItem handles a card with no status set", () => {
  const node = prNode({projectItems: {nodes: [{id: "ITEM_75", project: {number: 75}, fieldValueByName: null}]}});
  assert.deepEqual(pickProjectItem(node, 75), {itemId: "ITEM_75", currentLane: null});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test .github/scripts/project-board/snapshot.test.ts`
Expected: FAIL — cannot find module `./snapshot.ts`.

- [ ] **Step 3: Implement snapshot assembly**

`.github/scripts/project-board/snapshot.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test .github/scripts/project-board/snapshot.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Type-check and commit**

Run: `pnpm exec tsc -p .github/scripts/project-board/tsconfig.json`
Expected: exits 0.

```bash
git add .github/scripts/project-board/snapshot.ts .github/scripts/project-board/snapshot.test.ts
git commit -m "feat: assemble PR snapshots from GraphQL data for board reconciler"
```

---

### Task 3: GraphQL I/O and entrypoint

**Files:**
- Create: `.github/scripts/project-board/github.ts`
- Create: `.github/scripts/project-board/main.ts`

**Interfaces:**
- Consumes: `computeStatus` (Task 1), `buildSnapshot` / `pickProjectItem` / `PrNode` (Task 2), `STATUS_TO_LANE` (Task 1).
- Produces: CLI contract used by Task 4's workflow:
  - `node .github/scripts/project-board/main.ts` — event mode, reads `GITHUB_EVENT_PATH`
  - `node .github/scripts/project-board/main.ts --sweep` — sweep all open PR cards on the board
  - `node .github/scripts/project-board/main.ts --pr <owner>/<repo>#<number>` — reconcile one PR
  - Env: `PROJECT_BOARD_TOKEN` (empty ⇒ warn + exit 0), `PROJECT_ORG` (default `ChainSafe`), `PROJECT_NUMBER` (default `75`), `DRY_RUN` (`true`/`1` ⇒ log without writing).

- [ ] **Step 1: Implement the GraphQL layer**

`.github/scripts/project-board/github.ts`:

```ts
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
    };
  };
  const data = await gql<Res>(token, PROJECT_QUERY, {org, number});
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
      state
      isDraft
      reviewRequests(first: 100) {
        nodes { requestedReviewer { __typename ... on User { login } } }
      }
      reviews(last: 100) {
        nodes { state submittedAt author { __typename login } }
      }
      timelineItems(last: 100, itemTypes: [REVIEW_REQUESTED_EVENT]) {
        nodes {
          ... on ReviewRequestedEvent {
            createdAt
            requestedReviewer { __typename ... on User { login } }
          }
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
 * All OPEN pull requests whose card sits in one of the sweep lanes. Cards with
 * no status and cards parked in Backlog/Ready/Done are dropped here, so the
 * sweep never even fetches their PR detail. Event runs bypass this listing
 * entirely and reassert status regardless of lane.
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
```

- [ ] **Step 2: Implement the entrypoint**

`.github/scripts/project-board/main.ts`:

```ts
import {readFileSync} from "node:fs";
import {parseArgs} from "node:util";
import {computeStatus} from "./compute-status.ts";
import {fetchPr, listOpenBoardPrs, resolveProjectConfig, updateItemLane, type ProjectConfig} from "./github.ts";
import {buildSnapshot, pickProjectItem} from "./snapshot.ts";
import {STATUS_TO_LANE} from "./types.ts";

interface Ctx {
  token: string;
  org: string;
  projectNumber: number;
  dryRun: boolean;
  cfg: ProjectConfig;
}

async function reconcilePr(ctx: Ctx, owner: string, repo: string, number: number): Promise<void> {
  const label = `${owner}/${repo}#${number}`;
  const prNode = await fetchPr(ctx.token, owner, repo, number);
  if (!prNode) {
    console.log(`${label}: PR not found; skipping`);
    return;
  }
  const item = pickProjectItem(prNode, ctx.projectNumber);
  if (!item) {
    console.log(`${label}: not on project #${ctx.projectNumber}; skipping`);
    return;
  }
  const status = computeStatus(buildSnapshot(prNode));
  if (status === null) {
    console.log(`${label}: merged/closed; built-in workflow owns Done; skipping`);
    return;
  }
  const lane = STATUS_TO_LANE[status];
  if (item.currentLane === lane) {
    console.log(`${label}: already "${lane}"; no-op`);
    return;
  }
  if (ctx.dryRun) {
    console.log(`${label}: DRY RUN — would move "${item.currentLane ?? "(none)"}" -> "${lane}"`);
    return;
  }
  await updateItemLane(ctx.token, ctx.cfg, item.itemId, lane);
  console.log(`${label}: moved "${item.currentLane ?? "(none)"}" -> "${lane}"`);
}

function prFromEventPayload(): {owner: string; repo: string; number: number} | null {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  const payload = JSON.parse(readFileSync(path, "utf8"));
  const number = payload.pull_request?.number;
  const full = payload.repository?.full_name;
  if (typeof number !== "number" || typeof full !== "string") return null;
  const [owner, repo] = full.split("/");
  return {owner, repo, number};
}

async function main(): Promise<void> {
  const {values} = parseArgs({
    options: {pr: {type: "string"}, sweep: {type: "boolean", default: false}},
  });

  const token = process.env.PROJECT_BOARD_TOKEN ?? "";
  if (!token) {
    // Expected for pull_request_review runs on fork PRs (no secrets); the sweep reconciles those.
    console.warn("PROJECT_BOARD_TOKEN is empty; skipping (fork-PR event or misconfigured secret)");
    return;
  }
  const org = process.env.PROJECT_ORG || "ChainSafe";
  const projectNumber = Number(process.env.PROJECT_NUMBER || "75");
  const dryRun = ["1", "true"].includes((process.env.DRY_RUN ?? "").toLowerCase());
  const cfg = await resolveProjectConfig(token, org, projectNumber);
  const ctx: Ctx = {token, org, projectNumber, dryRun, cfg};

  if (values.pr) {
    const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(values.pr);
    if (!match) throw new Error(`--pr expects owner/repo#number, got: ${values.pr}`);
    await reconcilePr(ctx, match[1], match[2], Number(match[3]));
    return;
  }

  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  if (values.sweep || eventName === "schedule" || eventName === "workflow_dispatch") {
    const prs = await listOpenBoardPrs(token, org, projectNumber);
    console.log(`sweep: ${prs.length} open PR card(s) on project #${projectNumber}`);
    for (const pr of prs) {
      await reconcilePr(ctx, pr.owner, pr.repo, pr.number);
    }
    return;
  }

  const pr = prFromEventPayload();
  if (!pr) throw new Error(`event ${eventName} has no pull_request payload and no --pr/--sweep flag given`);
  await reconcilePr(ctx, pr.owner, pr.repo, pr.number);
}

await main();
```

- [ ] **Step 3: Type-check and run all unit tests**

Run: `pnpm exec tsc -p .github/scripts/project-board/tsconfig.json && node --test .github/scripts/project-board/compute-status.test.ts .github/scripts/project-board/snapshot.test.ts`
Expected: tsc exits 0; 20 tests pass.

- [ ] **Step 4: Live dry-run against one real PR (read-only, safe)**

Requires the fine-grained PAT (org `ChainSafe`, org permission Projects read/write, repository access "Public repositories"). Ask the user for it if not yet created.

Run (pick any open PR number from `gh pr list --limit 5`):

```bash
PROJECT_BOARD_TOKEN=$(cat ~/.config/gh/chainsafe-project-token) DRY_RUN=1 \
  node .github/scripts/project-board/main.ts --pr "ChainSafe/lodestar#<number>"
```

Expected: one line, either `already "<lane>"; no-op` or `DRY RUN — would move "<current>" -> "<computed>"`. Manually check the PR on github.com: the computed lane must match the spec's Model applied by hand (draft ⇒ In Progress; user re-request newer than last human comment review ⇒ Review Requested; etc.). Investigate any surprise before continuing — this is the reconciler meeting reality for the first time.

- [ ] **Step 5: Live dry-run sweep of the whole board (read-only, safe)**

```bash
PROJECT_BOARD_TOKEN=$(cat ~/.config/gh/chainsafe-project-token) DRY_RUN=1 \
  node .github/scripts/project-board/main.ts --sweep
```

Expected: a line per open PR card. Save the output and review the proposed moves with the user — this is the exact diff the automation would apply to the live board on first activation. Surprising moves here mean a spec or code bug; resolve before Task 4.

- [ ] **Step 6: Commit**

```bash
git add .github/scripts/project-board/github.ts .github/scripts/project-board/main.ts
git commit -m "feat: add project board reconciler entrypoint and GraphQL client"
```

---

### Task 4: Workflow and caller template

**Files:**
- Create: `.github/workflows/project-board.yml`
- Create: `.github/specs/project-board-caller.yml`

**Interfaces:**
- Consumes: Task 3's CLI contract (`main.ts`, env vars `PROJECT_BOARD_TOKEN` / `DRY_RUN`).
- Produces: the reusable workflow reference `ChainSafe/lodestar/.github/workflows/project-board.yml@unstable` used by accessory repos.

- [ ] **Step 1: Check the repo's action-pinning convention**

Run: `grep -h "uses: actions/checkout" .github/workflows/test.yml .github/workflows/docs.yml | sort -u`
Use the same ref style (e.g. `@v4` or a SHA pin) for `actions/checkout` and `actions/setup-node` below.

- [ ] **Step 2: Write the reusable workflow**

`.github/workflows/project-board.yml`:

```yaml
name: Project board

# Keeps the ChainSafe org project's Status lanes in sync with PR state.
# Spec: .github/specs/project-automation.md
# Safe with pull_request_target: this workflow never checks out or executes PR code —
# it only checks out ChainSafe/lodestar@unstable for the reconciler script.
on:
  pull_request_target:
    types:
      - opened
      - ready_for_review
      - converted_to_draft
      - review_requested
      - review_request_removed
      - reopened
  # No secrets on fork PRs for this event; main.ts exits 0 and the sweep reconciles instead.
  pull_request_review:
    types:
      - submitted
      - dismissed
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:
    inputs:
      pr:
        description: "owner/repo#number to reconcile (empty = sweep the whole board)"
        required: false
  # Entry point for accessory repos (thin callers; see .github/specs/project-board-caller.yml)
  workflow_call:

permissions: {}

concurrency:
  group: project-board-${{ github.event.pull_request.number || github.event_name }}
  cancel-in-progress: false

jobs:
  reconcile:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout reconciler (lodestar@unstable, never PR code)
        uses: actions/checkout@v4
        with:
          repository: ChainSafe/lodestar
          ref: unstable
          sparse-checkout: .github/scripts/project-board

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Reconcile
        run: node .github/scripts/project-board/main.ts ${{ inputs.pr && format('--pr {0}', inputs.pr) || '' }}
        env:
          PROJECT_BOARD_TOKEN: ${{ secrets.PROJECT_BOARD_TOKEN }}
          DRY_RUN: ${{ vars.PROJECT_BOARD_DRY_RUN }}
```

- [ ] **Step 3: Write the caller template**

`.github/specs/project-board-caller.yml`:

```yaml
# Copy this file to .github/workflows/project-board.yml in every repo managed by
# the Lodestar Team Coordination board. Requires the PROJECT_BOARD_TOKEN secret
# (org-level, or per-repo until the org secret exists).
# Spec: ChainSafe/lodestar/.github/specs/project-automation.md
name: Project board

on:
  pull_request_target:
    types:
      - opened
      - ready_for_review
      - converted_to_draft
      - review_requested
      - review_request_removed
      - reopened
  pull_request_review:
    types:
      - submitted
      - dismissed

permissions: {}

concurrency:
  group: project-board-${{ github.event.pull_request.number }}
  cancel-in-progress: false

jobs:
  project-board:
    uses: ChainSafe/lodestar/.github/workflows/project-board.yml@unstable
    secrets: inherit
```

- [ ] **Step 4: Lint**

Run: `pnpm lint` (biome ignores YAML unless configured; if it reports nothing for these files that is fine — the real validation is the rollout smoke test). Also re-run `pnpm docs:lint` if it covers `.github/specs/`.
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/project-board.yml .github/specs/project-board-caller.yml
git commit -m "feat: add project board automation workflow and caller template"
```

---

### Task 5: Rollout — dry-run in CI, smoke tests, enable writes

This task is a checklist executed with the user (secrets and merges need their access). Nothing here is code.

- [ ] **Step 1: Repo secret and dry-run variable (user action)**

In `ChainSafe/lodestar` → Settings → Secrets and variables → Actions:
- Secret `PROJECT_BOARD_TOKEN` = the fine-grained PAT (org `ChainSafe`, Projects read/write, public-repo read).
- Variable `PROJECT_BOARD_DRY_RUN` = `true`  ← the workflow is inert (logs only) until this changes.

- [ ] **Step 2: Open the PR to `unstable`**

```bash
git push -u origin mkeil/automate-project-board
gh pr create --base unstable --title "feat: automate project board PR status transitions" \
  --body "Implements .github/specs/project-automation.md. Ships in dry-run mode (PROJECT_BOARD_DRY_RUN=true). AI-assisted."
```

Note: `pull_request_target` and `schedule` use the workflow from the **default branch**, so nothing fires until this merges. Reviewers audit the spec + code; merging is safe because dry-run is on.

- [ ] **Step 3: After merge — verify the sweep dry-run**

Wait ≤15 min (or trigger manually: `gh workflow run project-board.yml`), then:
`gh run list --workflow=project-board.yml` and `gh run view <id> --log`.
Expected: sweep logs one line per open PR card, `DRY RUN — would move …` / `no-op`, zero errors.

- [ ] **Step 4: Event smoke tests (dry-run, using a scratch PR)**

Open a scratch draft PR in lodestar, then walk the lifecycle and check each triggered run's log shows the expected computed lane:

1. Open as draft → `In Progress`
2. Mark ready (no reviewers) → `In Progress`
3. Request a review from a teammate (user-level) → `Review Requested`
4. Teammate leaves a comment review → `Awaiting Author`
5. **Re-request review from the same teammate → `Review Requested`** ← confirms the undocumented re-request event, closing the spec's open verification item
6. Teammate approves → `Awaiting Author`
7. Convert to draft → `In Progress`
8. Close the PR → no reconciler move (built-in board workflow sets Done)

Any mismatch: fix code/spec, repeat before enabling writes.

- [ ] **Step 5: Enable writes on lodestar**

Set `PROJECT_BOARD_DRY_RUN` = `false` (or delete the variable). Re-run the scratch-PR lifecycle once; verify the card actually moves on the board. Announce to the team: the three middle lanes are now automation-owned.

- [ ] **Step 6: Roll out to accessory repos**

For each managed repo: add `.github/workflows/project-board.yml` from the caller template + the `PROJECT_BOARD_TOKEN` repo secret (until the org secret exists). Verify with one real PR event per repo.

- [ ] **Step 7: Post-rollout hardening (when the org admin returns)**

- Replace per-repo secrets with one org-level `PROJECT_BOARD_TOKEN`, scoped to the managed repos.
- Migrate PAT → org GitHub App: admin creates/installs the app (org Projects read/write), add `actions/create-github-app-token` step before "Reconcile" in `project-board.yml`, point `PROJECT_BOARD_TOKEN` env at its output, delete the PAT.
- Update the spec's Implementation section to match.
