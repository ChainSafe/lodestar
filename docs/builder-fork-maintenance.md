# Maintaining the builder fork

`nflaig/lodestar:unstable` is the shared integration branch for the builder stack.
It carries the custom builder features plus regular merges from
`ChainSafe/lodestar:unstable`. Deployment uses qualified commit hashes, never a
moving branch name.

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
reimplementations are not ancestry. In particular, #25's Cloudflare request-time
proposal is not part of this consolidation. Keep genuinely outstanding proposals
separate and recreate only their remaining diff against the consolidated base.

## Future work

1. Create short feature branches from the fork's `unstable` and target PRs there.
   Stack a PR only when it has an actual dependency. After its parent merges,
   update the child to the shared base without reintroducing older feature code.
2. Update upstream through a dedicated integration PR: branch from the fork's
   `unstable`, fetch ChainSafe's `unstable`, and merge that exact upstream commit.
   Resolve conflicts explicitly; do not reset the fork to upstream or force-push
   its shared branch.
3. Run tests for the changed interfaces. For state transition or wire changes,
   use `scripts/builder/captureNativeUpgrade.py` and
   `scripts/builder/qualifyNativeUpgrade.mjs` with pinned network inputs. Keep
   deployment canary results separate from offline compatibility results.
4. Pin the tested build in `builder-stack`, preserving active configuration and
   existing feature overlays. Qualify Plataberget before Sepolia. A merged PR is
   not evidence that a build has been deployed.

Temporary compatibility backports for an older deployed image should record the
upstream commit and exact runtime delta. They are not new long-lived integration
branches; remove their deployment overlays when the consolidated build replaces
the old image.
