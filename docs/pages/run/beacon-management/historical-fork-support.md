---
title: Historical Fork Support
---

# Historical Fork Support

Lodestar supports different historical fork ranges depending on the beacon node activity. This matrix documents the earliest supported fork for each activity, so operators and contributors can reason about support without relying on a single broad statement.

|                    | Syncing and serving | Following head | Block production |
| ------------------ | ------------------- | -------------- | ---------------- |
| **Supported from** | Phase0              | Fulu           | Fulu             |

Sync support includes both downloading and serving historical blocks. It does not imply support for following the head or producing blocks on those historical forks. These are operational support boundaries, not a list of fork-specific types and code paths retained for historical sync, replay, and tests.
