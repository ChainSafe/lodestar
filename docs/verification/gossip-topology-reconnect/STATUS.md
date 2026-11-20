# Correction in progress

The owned private Gloas network observed a healthy ReqResp connection while GossipSub had no corresponding peer. An ordinary disconnect/redial restores gossip without changing scores or validation. In the actual pinned libp2p 3.4.0 registrar, a deterministic deferred peer-store read reproduces a newer identify callback followed by an obsolete disconnect callback. Runtime diagnosis and the dependency-level reproduction are distinct evidence; actual fault/recovery qualification remains required.

Base: upstream unstable 3d90162. This review does not merge the separate Gloas fork-slot availability correction; the runtime composition retains that separately pinned source.
