---
title: Historical Fork Support
---

# Historical Fork Support

Lodestar supports different historical fork ranges depending on the beacon node activity. This matrix documents the earliest supported fork for each activity, so operators and contributors can reason about support without relying on a single broad statement.

|                    | Syncing | Following head | Block production |
| ------------------ | ------- | -------------- | ---------------- |
| **Supported from** | Phase0  | Phase0         | Electra          |

Future support policy for historical forks can be revisited as the network and maintenance needs change. For example, a release may choose to preserve older syncing and head-following paths while intentionally narrowing validator duties such as block production.
