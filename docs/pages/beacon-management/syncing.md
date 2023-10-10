# Syncing

Syncing an Ethereum node involves obtaining a copy of the blockchain data from other peers in the network to reach a consistent state. This process is crucial for new nodes or nodes that have been offline and need to catch up with the network's current state. Syncing can be performed for both the execution layer and the beacon chain, although the focus here will be primarily on the beacon chain.

Lodestar allows for several methods of syncing however the recommended method is `checkpoint sync` as it is the fastest and least resource intensive. It is generally a good idea to sync via a [`--checkpointSyncUrl`](./configuration.md#--checkpointSyncUrl) and to specify the [`--checkpointState`](./configuration.md#--checkpointState) that should be where the sync begins.

## Checkpoint Sync

Checkpoint sync, also known as state sync, allows a node to sync to a specific state checkpoint without having to process all historical data leading up to that point. In the context of a beacon node, this involves syncing to a recent finalized checkpoint, allowing the node to quickly join the network and participate in consensus activities. This is especially beneficial for new nodes or nodes that have been offline for a considerable duration. In the execution layer, checkpoint sync enables nodes to sync to a particular state, minimizing the time and resources required to become operational.

## Historical Sync

Historical sync involves processing all blocks from the genesis block or from a specified starting point to the current block. This is the most comprehensive sync method but also the most resource and time-intensive. For beacon nodes, historical sync is crucial for nodes that aim to maintain a complete history of the beacon chain, facilitating a deeper understanding and analysis of the network's history. In the execution layer, it ensures a complete historical record of the execution layer data.

## Range Sync

Range sync involves syncing blocks within a specified range, beneficial when a node is only temporarily offline and needs to catch up over a short range. In the beacon node context, this entails requesting and processing blocks within a defined range, ensuring the node quickly gets updated to the current network state.

## Snapshot Sync

Snapshot sync is a method where nodes download a compressed snapshot of the current state and the blocks leading up to it. This method provides a balance between speed and historical data preservation, allowing nodes to quickly sync while still obtaining a relatively comprehensive view of the blockchain history.
