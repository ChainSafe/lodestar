# Pull Request Review Policy

## Purpose

This policy organizes how we request, perform, and follow up on pull request reviews. Its goals:

- Distribute review work across the team and direct reviews to domain experts
- Keep reviews timely so PRs do not sit blocked waiting on feedback
- Make review responsibility explicit, so that no team member feels obligated to review everything, and no code merges without proper vetting

This is not a departure from our current process; it makes existing expectations explicit. All code owners share responsibility for the quality of the code that gets merged. Quality is a property of the team and its process, not of any individual

## Principles

1. **Reviews are assigned, not ambient.** Review responsibility is created by an explicit request. If you were not requested, you are not responsible
2. **Responsibility transfers with the request.** Once a PR has its requested reviewer(s), they own the review
3. **Timeliness is part of quality.** A slow review costs the team as much as a defect that slips through

## 1. Requesting a Review

- The PR author selects one reviewer (or two, where they feel it appropriate) from the team, ideally based on domain relevance or to engage members that can benefit from the nudge
- We will remove the blanket CODEOWNERS auto-notification. A review request should be a clear, personal signal, not background noise sent to everyone
- Team time is limited: request only the reviewers whose input you actually want on the code

## 2. Responsibilities of the Requested Reviewer

- Respond within the review SLA (Section 3) with substantive feedback
- A response means comments, not necessarily approval. Being requested for review does not obligate you to approve the PR
- A voluntary review by someone else does not discharge the requested reviewer's responsibility (see Section 4)

## 3. Review SLA

- Only working days are counted for SLA. Weekends and holidays are excluded as non-working days
- **SLA: 2 business days.** The SLA is where escalation happens, not the target
- **Target: initial feedback within 24 hours.** Faster than the SLA is always welcome but not required
- If the SLA lapses, the author escalates to a team lead, who either reassigns the review or does the review themselves
- Repeated lapses are handled by the team lead directly with the reviewer, informed by the review-load metrics (Section 8). The goal is rebalancing workload, not assigning blame

## 4. Voluntary Reviews

- Anyone may review any PR at any time. Voluntary ("drive-by") reviews are welcomed but never required
- A voluntary review is a non-blocking contribution: it creates no obligation for the volunteer and removes none from the requested reviewer
- **If you were not requested, you are not responsible.** No team member should feel they need to monitor or vet all incoming code. That burden belongs to no one; the request mechanism exists so it is shared deliberately

## 5. Merging

- The author is responsible for merging the PR after the requested reviewer(s) have responded, or after the SLA escalation path (Section 3) has elicited a review
- The author is the final arbiter of what is good to merge, subject to open review requests (Sections 2 and 6)
- A voluntary approval may inform the author's decision at their discretion, but it does not replace the requested review unless a team lead has reassigned the review under Section 3

## 6. Additional Review Requests

- At any point in the review process, any team member may request that another team member review a PR. The purpose is to bring in domain expertise where someone judges it necessary
- An additional review request is **binding**: the requested reviewer must provide feedback, and the author must wait for that feedback before merging
- Additional requests run on the same SLA as any other review request (Section 3), including the escalation path. Binding, but bounded

## 7. Post-Merge Reviews and Comments

Time is tight, and a PR may merge before every requested reviewer has had a chance to look at it (time-sensitive merges, vacations)

- An outstanding review request survives the merge: the requested reviewer should still review the code when they are able. There is no deadline on post-merge review, but resolution of findings is tracked (below)
- Anyone may comment on a merged PR at any time. It is on the commenter to notify the author; authors are not expected to monitor closed PRs
- Post-merge findings are resolved through one of two mechanisms:
  1. **An issue** pointing to the comments. This is an implicit request for the original author to address the findings
  2. **A fix PR** opened by the commenter, with the discussion living on that PR
- The issue or fix PR is the tracking mechanism for follow-up by the team and the team lead
- **Vacation:** if a requested reviewer is away and the merge is time-sensitive, another team member may step in to review and unblock the merge. The outstanding request then serves as the returning reviewer's catch-up list; they can focus on the PRs teammates flagged for them rather than everything merged while they were away

## 8. Review Load, Metrics, and Reassignment

- The team will regularly review the distribution of requested and completed reviews, using lightweight metrics (e.g., review counts from GitHub, discussed at retros)
- If a team member is being requested for, or performing, a disproportionate share of reviews, the team or a team lead can reassign reviews to others
- Reassignment is also a training mechanism: spreading reviews grows domain expertise across the team so that no one becomes the sole expert for any area

## 9. Arbitration

- From time to time an author and a reviewer will disagree on a feature, idea, comment, or fix. If they cannot resolve it between themselves, either party may propose a third-party arbiter
- If no arbiter is agreed within the SLA (2 business days), a team lead assigns one
- The arbiter makes the final call. If the arbiter is not comfortable deciding alone, they may bring in another person to help reach the decision

## 10. Daily Review Tracking Report

Companion automation for this policy. A daily markdown report shows review status at a glance without opening PRs or digging through notifications, and structured snapshots are archived for historical analysis

Goals, in order: identification (what is waiting on whom), enforcement support (what is past the SLA window), and historical analysis (load distribution, time-to-review, requested vs voluntary review counts). Non-goals: pinging people, leaderboards, or any per-person scoring in the report itself

### Runtime

- GitHub Action in the lodestar repo: `.github/workflows/review-report.yml`
- Schedule: daily cron at `01:00 UTC` (08:00 ICT), so the report is ready for Asia-based team members at the start of their day, after North America is usually offline. Also `workflow_dispatch` for manual runs
- One script (TypeScript, executed with the repo's existing toolchain) under `scripts/`, run in four phases: fetch → snapshot → render → deliver
- Auth: the built-in `GITHUB_TOKEN` (contents: write for the data branch, issues: write for the report comment). The optional Discord step would add one webhook secret later

### Data Collection

One GraphQL query set against the lodestar repo:

- **Open PRs**, excluding drafts and bot authors (dependabot etc.): number, title, author, URL, `createdAt`, currently requested reviewers, and timeline events for review requests (who was requested, when)
- **Reviews submitted** on those PRs: reviewer, `submittedAt`, state (approved / changes requested / commented). Each review is classified as **requested** (the reviewer was a requested reviewer at submission time) or **voluntary** (drive-by). Voluntary reviews are the signal for "this person is doing reviews nobody asked them for" and inform feedback conversations; they appear in the snapshot data only, not in the report
- **PRs closed or merged since the last run**: number, author, `createdAt`, `closedAt`/`mergedAt`, merged flag. Captured for open-to-close duration analysis

### Report

Delivered as a new comment on a pinned "Daily Review Report" tracking issue. Sections in order:

1. **Past SLA review window**: review requests older than 2 business days (weekends and holidays excluded), listed as PR link/title plus requested reviewer. No ages, no ordering by lateness; just what is lagging. Empty section renders as "None"
2. **New review requests** (since the last run): PR link/title, author, requested reviewer(s)
3. **Open review requests by team member**: one list per person of the PRs currently waiting on them. The grouping is derived from whoever appears as a requested reviewer; there is no team roster to maintain

No timing information is displayed anywhere; timestamps are used only to decide membership in the Past SLA section. Nobody appears in the report unless they have an open request

### History (Data Branch)

Each run commits `review-metrics/YYYY-MM-DD.json` to the dedicated `review-metrics` branch. The snapshot is deliberately richer than the report:

```jsonc
{
  "generatedAt": "2026-07-18T01:00:00Z",
  "lastProcessedPr": 9682, // watermark: highest PR number seen
  "openPrs": [
    {
      "number": 9679,
      "title": "...",
      "author": "...",
      "createdAt": "...",
      "reviewRequests": [{"reviewer": "...", "requestedAt": "..."}],
      "reviews": [{"reviewer": "...", "submittedAt": "...", "state": "APPROVED", "requested": false}],
    },
  ],
  "closedPrs": [{"number": 9670, "author": "...", "createdAt": "...", "closedAt": "...", "merged": true}],
}
```

This supports later analysis without changing the collector: reviews-per-person (requested vs voluntary split), time from request to review, time from open to close, and load trends are all "write a script over the branch" problems. More robust analysis scripts can be added as needed

### New-Since-Last-Run Detection

- **New PRs**: any PR with a number greater than the previous snapshot's `lastProcessedPr` watermark
- **New review requests on existing PRs**: any review-request timeline event with `requestedAt` after the previous snapshot's `generatedAt`. (Additional review requests under Section 6 land on already-open PRs, so the watermark alone would miss them)
- First run (no previous snapshot): everything currently open is treated as pre-existing; the "New review requests" section states that tracking starts today

### Exclusions

- Draft PRs and bot-authored PRs are excluded from all sections and from snapshots

### Discord Delivery (Optional, Later)

A final isolated workflow step posts a trimmed version (section counts, the Past SLA list, and a link to the full issue comment) to a Discord webhook. Nice to have, not need to have; nothing in the design depends on it
