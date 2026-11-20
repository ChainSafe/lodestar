# Gossip topology reconnect correction

The actual pinned libp2p 3.4.0 registrar reproduces a newer identify followed by obsolete disconnect/protocol-removal callbacks. The dependency patch uses bounded per-peer lifecycle generations across awaited work, preserves legitimate final disconnects and unrelated peers, and keeps a limited connection from cancelling an unlimited identify. Seven regressions pass against the delivered installed dependency. The original five-case campaign has three failures and two passing controls on the unmodified dependency; the completed patch also covers two additional identify cases.

TypeScript 6.0.3 reproduces the unmodified published registrar before generating the patched runtime, declaration and source map. The frozen lock changes only this patch. All TypeScript workspaces build with unchanged native bindings excluded; beacon-node type check and full Biome check pass, with seven existing warnings.

The real private Gloas composition retains application cf705 and adds dependency source fa03d65, patch SHA-256 0631b733bc0a2774aad1d83452ee3ebaf28a711eca4481deab0a4f0f71a94736. Its normal startup/catch-up is 10.649 seconds under 300. Three six-second provider outages automatically maintain or restore gossip and a canonical Lodestar-validator proposal in 6.605, 0.082 and 2.241 seconds, under the predeclared 90-second maximum. No debug reconnect, scoring reset or validation change is used. Exact runtime module hashes are retained in the process deployment manifest. A separate final-composition operating window is running.

This source review starts at upstream unstable 3d90162. The qualified runtime's separate fork-slot correction remains explicitly identified by application cf705.
