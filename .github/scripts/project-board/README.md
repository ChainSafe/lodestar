# Project Board Automation — PR Status Transitions

Automates the Status field for PR cards on [Lodestar Team Coordination](https://github.com/orgs/ChainSafe/projects/75) (org project #75). Lanes answer one question: **who acts next**. The automation only moves cards — it never approves, merges, or modifies PRs.

## What counts as a signal

- **Review requests:** only **user-level** requests count. Team-level requests are ignored — CODEOWNERS auto-requests `@ChainSafe/lodestar` on every PR and team requests never clear when members review (verified live + docs). Requesting/re-requesting a **specific person** is the signal. (A PR to remove CODEOWNERS is open; this automation strengthens the case, but the filter makes it work either way.)
- **Reviews:** only reviews from **User-type** accounts count. Reviews from **Bot-type** accounts (GitHub Apps: codex, gemini, etc. — they comment on every PR) are ignored. Machine accounts that are regular users (e.g. `lodekeeper`) intentionally count as users: they only review when explicitly asked, so their reviews are treated like any teammate's.

## Invariants

1. Draft PR → always **In Progress**, even with reviewers requested.
2. **Review Requested** ⟺ non-draft AND ≥1 pending user-level review request (unless a counted review is newer — see Model).
3. **Awaiting Author** = author owes action: changes requested, comments left, or fully approved and awaiting merge.
4. Merged/closed → **Done** (handled natively by the project's built-in workflows; the automation does nothing here).

## Transitions

| Event                                     | Condition                                                                       | Status           |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| PR opened / reopened / converted to draft | draft                                                                           | In Progress      |
| PR opened / reopened / marked ready       | non-draft, no user-level reviewers requested                                    | In Progress      |
| Review requested (or re-requested)        | non-draft, user-level request                                                   | Review Requested |
| PR reopened / marked ready                | user-level reviewers already requested                                          | Review Requested |
| Review: changes requested / commented     | counted reviewers only — even with other reviewers pending, including drive-bys | Awaiting Author  |
| Review: approved                          | other user-level review requests still pending                                  | no change        |
| Review: approved                          | no pending user-level review requests left                                      | Awaiting Author  |
| Commits pushed                            | always                                                                          | no change        |
| Review request removed / review dismissed | recompute (see Model)                                                           | per invariants   |
| PR merged/closed                          | always (built-in project workflow)                                              | Done             |

The reconciler owns the `reopened` transition. The project's built-in **Item reopened** workflow must remain disabled to avoid competing status writes.

**Team convention:** reviewers normally submit **comment** reviews rather than "request changes" (a changes-requested review blocks merging until re-reviewed, which causes stale-review friction). The automation treats both identically, so the convention is optional as far as the board is concerned.

**Pushing commits never moves the card.** The author addressing feedback stays in Awaiting Author until the author clicks **re-request review** (or requests an additional reviewer) — that click is the only "please look again" signal.

**Why changes/comments move immediately:** reviewing code that's about to change wastes the second reviewer's time. Author addresses feedback, then **re-request review** flips it back to Review Requested — that click is the explicit "please look again" signal.

**Why approval is conditional:** one approval must not silence the "reviewer still needed" signal while others owe reviews.

## Model: reconciler, not event rules

Events do not map directly to moves. Every relevant event (and the sweep) triggers a recompute of the correct lane from the PR's **current full state** — draft flag, pending user-level review requests, non-dismissed counted reviews — and writes it. This makes the automation idempotent, self-healing (missed webhooks, coalesced events, and manual drags get corrected), and handles removed requests / dismissed reviews with no special cases. An event run reconciles only the PR that triggered it — it never touches the rest of the board. If that PR has no card yet (the built-in auto-add can lag the event), the event run adds the card itself — `addProjectV2ItemById` is idempotent with auto-add — and then places it. The sweep reconciles only open PR cards already sitting in the three automated lanes.

`computeStatus(pr)` precedence:

1. Merged or closed → **Done** (built-in workflow; reconciler skips)
2. Draft → **In Progress**
3. The latest ready-for-review or reopened event starts a new review cycle. Older reviews and completed request signals are ignored. User-level requests that remain pending carry into the new cycle.
4. **Latest signal wins:** while at least one user-level review request is pending, compare the newest non-removed user-level request signal against the newest non-dismissed comment/changes-requested counted review. Request is newer (or tied) → **Review Requested**; review is newer → **Awaiting Author** — a timestamp tie goes to the request, since a re-request is an explicit signal
5. No pending requests and no comment/changes reviews: any approval → **Awaiting Author**; no reviews at all → **In Progress**

Request timestamps are not exposed on pending requests. They are reconstructed from `REVIEW_REQUESTED_EVENT` and `REVIEW_REQUEST_REMOVED_EVENT` timeline items. A request remains a signal after its reviewer responds because an approval with another reviewer pending is a no-op. An explicit removal cancels only that reviewer's latest request signal. Request signals are ignored when no user-level requests remain pending.

## Implementation

- The full logic lives in a **reusable workflow** in `ChainSafe/lodestar` (`workflow_call`). Each accessory repo managed by the board adds an identical thin caller workflow — behavior is uniform across all repos by construction.
- Triggers:
  - `pull_request_target` (opened, ready_for_review, converted_to_draft, review_requested, review_request_removed, reopened) — runs with secrets even for fork PRs; safe because the workflow never checks out or executes PR code.
  - `pull_request_review` (submitted, dismissed) — **no secrets for fork PRs** (documented GitHub restriction), so review-driven moves on fork PRs are picked up by the sweep instead (≤15 min latency). Same-repo PRs move instantly.
  - `schedule` — sweep every 15 minutes: recompute open PR cards in the three automated lanes; self-heals fork-PR reviews, missed events, and manual drags.
- Concurrency: one group per PR, `cancel-in-progress: false`. GitHub keeps only the newest pending run per group; coalescing is safe because the reconciler recomputes from full state.
- Auth: the default `GITHUB_TOKEN` cannot access org projects (documented). Interim: fine-grained PAT (resource owner ChainSafe; org **Projects: read/write**, repo **Pull requests: read** + **Metadata: read**) stored as an Actions secret. Target: an org-owned GitHub App — swapping replaces the secret with an `actions/create-github-app-token` step; logic unchanged.
- **To verify empirically before rollout:** that re-requesting review from someone who already reviewed fires `review_requested` — universally observed, but not documented by GitHub.

## Scope

PR cards on project #75 only. Status field only. Issues and PRs not on the board are ignored.

- **Event runs are idempotent and unconditional:** a PR event reasserts the computed status no matter which lane the card is in — e.g. a review requested on a PR parked in Backlog moves it to Review Requested. **Event runs also own initial placement:** if the PR's card is missing (auto-add race) the run adds it, and a card with no status gets its lane set — a PR opened as draft lands in In Progress without the author touching the board.
- **The sweep is scoped:** it only processes open PR cards whose Status is already one of the three automated lanes. Cards with no status (old/stale PRs are triaged manually) and cards parked in Backlog/Ready/Done are left alone by the sweep, since a sweep carries no new signal. The sweep never adds cards.

The lanes **In Progress ↔ Review Requested ↔ Awaiting Author** are 100% automation-owned for PR cards: cards must not be moved between them manually, and the automation reasserts the computed status on every relevant event. The same workflow will be deployed identically to every ChainSafe repo managed by this board.
