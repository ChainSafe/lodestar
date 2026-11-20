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
- #29: the stream client, cleanup and retry fixes are included through later
  commits; merging its older integration branch would add obsolete code.
- #36: the optional assumed identity is included with later staged identity
  checks. Deployments without those explicit options still use the registry.

### November merge review

The whole-file resolutions were compared with upstream changes since the common
ancestor, including files that had no textual conflict:

| Files | Resolution |
| --- | --- |
| Builder assembly, defaults, exports, metrics and test utilities | The fork already carries upstream's bidding and reveal pipeline, with continuous revisions, staged identities and recovery added. Preserve those extensions. |
| Identity and tests | Restore per-slot pending polling. Retain the fork's explicit handling of a pre-Gloas head at the fork slot; tests cover both a 400 response and a pending identity, followed by activation one slot later. |
| Bid ledger and tests | Retain settlement and the fork's branch-aware liabilities and recovery. The upstream three-epoch payment-settlement limitation still applies and is documented in the package README. |
| Payload orchestrator and tests | Last preparation error reporting and bounded retries are already present, alongside constructor reservation recovery. |
| Builder CLI options and README | Restore the event-emission requirement, current spec badge and payment-settlement limitation. Keep constructor options alongside Engine access. |
| Nightly workflow, devnet configuration and launcher | Preserve the Docker builder and HTTP API checks. Restore the Kurtosis and artifact versions, coherent metrics sampling and Docker base-image refresh. Host-side Node/Zig builds are unnecessary because the Docker build owns compilation. |

The review also restored the Engine FCU `INVALID` check and corrected deadlines
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

Temporary compatibility patches for an older deployed image should record the
upstream commit and exact runtime delta. They are not new long-lived integration
branches; remove their deployment overlays when the consolidated build replaces
the old image.
