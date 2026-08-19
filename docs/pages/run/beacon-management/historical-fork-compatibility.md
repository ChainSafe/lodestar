---
title: Historical Fork Compatibility
---

# Historical Fork Compatibility

Lodestar supports different historical fork ranges depending on the beacon node activity. This matrix documents the current support boundary for each activity so operators and contributors can discuss compatibility without relying on a single broad statement.

| Activity         | Supported from | Notes                                                                                                                                        |
| ---------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Syncing          | Phase0         | Lodestar can sync historical beacon chain data from genesis and continue through later forks.                                                |
| Following head   | Phase0         | A synced node can continue importing blocks, running fork choice, and following the canonical head across historical forks.                  |
| Block production | Electra        | Lodestar supports block production for Electra and later forks. Pre-Electra block production is not part of the currently supported surface. |

In this context, "Phase0" means the original beacon chain fork at genesis, and each entry includes later forks unless a narrower boundary is listed.

Future support policy for historical forks can be revisited as the network and maintenance needs change. For example, a release may choose to preserve older syncing and head-following paths while intentionally narrowing validator duties such as block production.
