# Syncing

Syncing an Ethereum node involves obtaining a copy of the blockchain data from other peers in the network to reach a consistent state. This process is crucial for new nodes or nodes that have been offline and need to catch up with the network's current state. Syncing can be performed for both the execution layer and the beacon chain, although the focus here will be primarily on the beacon chain.

Lodestar allows for several methods of syncing however the recommended method is `checkpoint sync` as it is the fastest and least resource intensive. It is generally a good idea to sync via a [`--checkpointSyncUrl`](./configuration.md#--checkpointSyncUrl).  If starting at a specific point is necessary specify the [`--checkpointState`](./configuration.md#--checkpointState) that should be where the sync begins.

## Weak Subjectivity

Weak subjectivity is a concept aimed at ascertaining the active chain amidst potential conflicting versions. It is realized through "weak subjectivity checkpoints", which are specific state roots acknowledged by all network nodes as belonging to the canonical chain. They serve as the "universal truth" from a node's perspective, and will remain unaltered despite any new information from peers.

The concept of weak subjectivity emerges predominantly in two scenarios: when new nodes join the network and when existing nodes resume online activity after a significant offline duration. During these instances, the weak subjectivity period defines the time frame within which a client, upon rejoining, can reliably process blocks to reach the consensus chain head. Essentially, weak subjectivity mitigates the risks associated with long-range attacks, which might occur if nodes solely trusted the longest chain without any initial trust in a specific network state.

## Syncing Methods

### Checkpoint Sync

Checkpoint sync, also known as state sync, allows a node to sync to a specific state checkpoint without having to process all historical data leading up to that point. In the context of a beacon node, this involves syncing to a recent finalized checkpoint, allowing the node to quickly join the network and participate in consensus activities. This is especially beneficial for new nodes or nodes that have been offline for a considerable duration. In the execution layer, checkpoint sync enables nodes to sync to a particular state, minimizing the time and resources required to become operational.

### Historical Sync

Historical sync involves processing all blocks from the genesis block or from a specified starting point to the current block. This is the most comprehensive sync method but also the most resource and time-intensive. For beacon nodes, historical sync is crucial for nodes that aim to maintain a complete history of the beacon chain, facilitating a deeper understanding and analysis of the network's history. In the execution layer, it ensures a complete historical record of the execution layer data.

### Range Sync

Range sync involves syncing blocks within a specified range, beneficial when a node is only temporarily offline and needs to catch up over a short range. In the beacon node context, this entails requesting and processing blocks within a defined range, ensuring the node quickly gets updated to the current network state.

### Snapshot Sync

Snapshot sync is a method where nodes download a compressed snapshot of the current state and the blocks leading up to it. This method provides a balance between speed and historical data preservation, allowing nodes to quickly sync while still obtaining a relatively comprehensive view of the blockchain history.

## Syncing Lodestar

The implementation of the different syncing styles in Lodestar are actually one of two types under the hood, range sync and unknown sync.  Range sync is used when the start point of syncing is known.  In the case of historical and checkpoint sync the starting points are well defined, genesis and the last finalized epoch boundary.  Snapshot sync is not supported by Lodestar. If the starting point for sync is not known Lodestar must first determine where the starting point is.  While the discussion about how that happens is out of scope for this document, the gist is that the beacon node will listen to gossipsub for blocks being broadcast on the network.  It will also request [`MetaData`](https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/p2p-interface.md#getmetadata) from its peers and use that to start requesting the correct blocks from the network.

There are several flags that can be used to configure the sync process.

- [`--checkpointSyncUrl`](./configuration.md#--checkpointSyncUrl)
- [`--checkpointState`](./configuration.md#--checkpointState)
- [`--wssCheckpoint`](./configuration.md#--wssCheckpoint)
- [`--forceCheckpointSync`](./configuration.md#--forceCheckpointSync)
