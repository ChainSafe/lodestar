# Maintaining the builder fork

`nflaig/lodestar:builder` is the shared integration branch for the builder stack.
It carries the custom builder features plus reviewed merges from
`ChainSafe/lodestar:unstable`. The fork's default branch remains `unstable`, an
upstream mirror. Deployment uses qualified commit hashes, never a moving branch name.

Builder feature PRs target `builder`. For contributions to ChainSafe, start from
the upstream mirror and target `ChainSafe/lodestar:unstable`.

## Branch migration

The former integration branch was renamed from `unstable` to `builder` at
`5b38029d99892f24e54aef7e562cac53041c07c7`, preserving its complete history
and branch protection. The repository default is `unstable`. The tag
`archive/builder-unstable-20261120` also retains that commit. Draft PR #25 follows
the renamed base without changing its proposed code.

The recreated `unstable` points to upstream
`3d90162721dfcd809c48538e8abf77d2db4a6be0`. Moving the mirror does not merge that
commit into `builder`; upstream changes still require an integration PR and
qualification before deployment. Never reset `builder` to the mirror.

CI includes pushes and PRs to `builder`. The external-contributor lockfile check
compares the checked-out PR with its actual base branch, using full Git history.
The fork disables the automatic Publish and Deploy docs workflows in repository
settings: the clean upstream mirror cannot carry the fork's release guards.
Manual publication remains an explicit operation.

Existing images retain their recorded source commit and historical branch label.
This migration does not change runtime source or require redeployment. If a local
`unstable` branch contains the former builder stack, migrate its tracking without
resetting it:

```sh
git branch -m unstable builder
git fetch origin
git branch --set-upstream-to=origin/builder builder
git remote set-head origin -a
```

Keep unrelated feature branches and uncommitted work intact. Create a separate
local branch from `origin/unstable` when working on upstream contributions.

## Consolidating the October stack

PR #58 consolidates the deployed publisher stack rooted at
`4517e905f9d096ce5f0c7babb729a8a31f629a4c` with upstream
`269cf1aa5bcfdc219f97345fe323dbcc4b1557fa`. The fork's `unstable` was fast-forwarded
to that upstream commit on 20 November 2026. This removes 910 upstream commits
from the comparison; the remaining changes are the custom builder stack and its
upgrade qualification tools.

Merge the consolidation with a merge commit after its review and qualification.
Retaining ancestry makes subsequent upstream merges and feature attribution
straightforward. Do not merge the older stacked branches into the new baseline
individually: some have older copies of features that were subsequently fixed or
adapted on the deployed stack.

PRs #5, #6, #7, #8, #11 and #20 are ancestors of the consolidation. They can be
retired as incorporated when the consolidation is merged. Other old PRs require
an explicit check of their remaining changes, because cherry-picks and later
rewrites are not ancestry. In particular, #25's Cloudflare request-time
proposal is not part of this consolidation. Keep genuinely outstanding proposals
separate and recreate only their remaining diff against the consolidated base.

The other old branches have been compared explicitly:

- #9: controlled payloads are retained. Its final preference-wait variant is
  superseded by the current preference recovery and continuous update path.
- #10: pending identities now poll every slot. The old behavior that acknowledged
  and discarded preferences during startup is deliberately excluded; startup
  returns an unavailable response until those preferences can be processed.
- #12 and #27: the subsidy cutoff is included in the consolidated publisher.
- #21: its only extra commit adds dictionary words that are already present.
- #29: the publisher cleanup and retry fixes are included through later
  commits; merging its older integration branch would add obsolete code.
- #36: the optional assumed identity is included with later staged identity
  checks. Deployments without those explicit options still use the registry.

### November merge review

The whole-file resolutions were compared with upstream changes since the common
ancestor, including files that had no textual conflict:

| Files                                                           | Resolution                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Builder assembly, defaults, exports, metrics and test utilities | The fork already carries upstream's bidding and reveal pipeline, with continuous revisions, staged identities and recovery added. Preserve those extensions.                                                                               |
| Identity and tests                                              | Restore per-slot pending polling. Retain the fork's explicit handling of a pre-Gloas head at the fork slot; tests cover both a 400 response and a pending identity, followed by activation one slot later.                                 |
| Bid ledger and tests                                            | Retain settlement and the fork's branch-aware liabilities and recovery. The upstream three-epoch payment-settlement limitation still applies and is documented in the package README.                                                      |
| Payload orchestrator and tests                                  | Last preparation error reporting and bounded retries are already present, alongside constructor reservation recovery.                                                                                                                      |
| Builder CLI options and README                                  | Restore the event-emission requirement, current spec badge and payment-settlement limitation. Keep constructor options alongside Engine access.                                                                                            |
| Nightly workflow, devnet configuration and launcher             | Preserve the Docker builder and HTTP API checks. Restore the Kurtosis and artifact versions, coherent metrics sampling and Docker base-image refresh. Host-side Node/Zig builds are unnecessary because the Docker build owns compilation. |

The review also restored the Engine `forkchoiceUpdated` `INVALID` check and corrected deadlines
measured in the preceding slot to use that slot's fork duration. Qualification
includes an actual old-build journal written with array transactions and recovered
by the new build with serialized transactions, preserving payload bytes, signed
bid roots and reveal obligations without granting new offers. Native and
TypeScript FULL-parent liability preparation agree at the exact balance boundary.

The frozen lockfile installs in a clean source tree with pnpm 11.0.0; lifecycle
scripts were disabled for that dependency check and builds were qualified
separately. Documentation wording changes in this round address the fork's
hosted spelling check. GitHub-hosted runners are used when ChainSafe's Warp
runners are unavailable to the fork.

## Development workflow

1. Create short feature branches from the fork's `builder` and target PRs there.
   Stack a PR only when it has an actual dependency. After its parent merges,
   update the child to `builder` without reintroducing older feature code.
2. Update upstream through a dedicated integration PR: branch from the fork's
   `builder`, fetch ChainSafe's `unstable`, and merge that exact upstream commit.
   Resolve conflicts explicitly; do not reset the fork to upstream or force-push
   its shared branch.
3. Run tests for the changed interfaces. For state transition or wire changes,
   use `scripts/builder/captureNativeUpgrade.py` and
   `scripts/builder/qualifyNativeUpgrade.mjs` with pinned network inputs. Keep
   deployment canary results separate from offline compatibility results.
4. Pin the tested build in `builder-stack`, preserving active configuration and
   required runtime settings. Qualify Plataberget before Sepolia. A merged PR is
   not evidence that a build has been deployed.

Temporary compatibility patches for an older deployed image should record the
upstream commit and exact runtime delta. They are not new long-lived integration
branches; remove their deployment overlays when the consolidated build replaces
the old image.

## Proposer receiver deployment parity

The November image audit found that the deployed Plataberget proposer beacon had
an additional receiver branch at `8fcee35bc3eb62a03a91850e03b432b66233f67e`.
That branch was absent from the publisher-based consolidation. Restore its delayed
and repeated requests, authenticated WebSocket client, bounded HTTP fallback,
TLS connection timing fixes, shutdown handling and receipt diagnostics before
replacing that beacon's image. The publisher's WebSocket server was already
included.

The restored client keeps the current upstream native state transition and
block-production validation. Its receiver modules match the deployed branch;
integration tests use the current `@lodestar/native` package. Qualify the entire
runtime command as well as the publisher branch when replacing a composite image.
