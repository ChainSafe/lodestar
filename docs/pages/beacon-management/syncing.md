# Syncing

Syncing an Ethereum node involves obtaining a copy of the blockchain data from other peers in the network to reach a consistent state. This process is crucial for new nodes or nodes that have been offline and need to catch up with the network's current state. Syncing can be performed for both the execution layer and the beacon chain, although the focus here will be primarily on the beacon chain.

Lodestar allows for several methods of syncing however the recommended method is `checkpoint sync` as it is the fastest and least resource intensive. It is generally a good idea to sync via a [`--checkpointSyncUrl`](./beacon-cli.md#-checkpointsyncurl). If starting at a specific point is necessary specify the [`--checkpointState`](./beacon-cli.md#-checkpointstate) that should be where the sync begins.

## Weak Subjectivity

Weak subjectivity is a concept specific to Proof of Stake (PoS) systems, addressing how new nodes can safely join the network and synchronize with the correct blockchain history. Unlike in Proof of Work (PoW) systems, where a node can trust the longest chain due to the significant computational effort required to forge it, PoS systems present different challenges. In PoS, the cost of creating or altering blockchain history is lower, as it is not based on computational work but on the stake held by validators. This difference raises the possibility that an attacker, if possessing sufficient stake, could feasibly create a misleading version of the blockchain history.

The concept of weak subjectivity becomes particularly crucial in two scenarios: when new nodes join the network and when existing nodes reconnect after a significant period of being offline. During these times, the 'weak subjectivity period' defines a time frame within which a client, upon rejoining, can reliably process blocks to reach the consensus chain head. This approach is essential for mitigating the risks associated with long-range attacks, which could occur if nodes relied solely on the longest chain principle without any initial trust in a specific network state.

To counter these risks, weak subjectivity requires new nodes to obtain a recent, trusted state of the blockchain from a reliable source upon joining the network. This state includes vital information about the current set of validators and their stakes. Starting from this trusted state helps new nodes avoid being misled by false histories, as any attempt to rewrite history beyond this point would require an unrealistically large portion of the total stake.

## Syncing Methods

### Checkpoint Sync

Checkpoint sync, also known as state sync, allows a node to sync to a specific state checkpoint without having to process all historical data leading up to that point. In the context of a beacon node, this involves syncing to a recent finalized checkpoint, allowing the node to quickly join the network and participate in consensus activities. This is especially beneficial for new nodes or nodes that have been offline for a considerable duration.

### Historical Sync

Historical sync involves processing all blocks from the genesis block or from a specified starting point to the current block. This is the most comprehensive sync method but also the most resource and time-intensive. For beacon nodes, historical sync is crucial for nodes that aim to maintain a complete history of the beacon chain, facilitating a deeper understanding and analysis of the network's history. In the execution layer, it ensures a complete historical record of the execution layer data.

### Range Sync

Range sync involves syncing blocks within a specified range, beneficial when a node is only temporarily offline and needs to catch up over a short range. In the beacon node context, this entails requesting and processing blocks within a defined range, ensuring the node quickly gets updated to the current network state.

### Backfill Sync

This is another version of checkpoint sync that allows a node that has not been historically synchronized to verify data prior to the checkpoint. It is done via downloading a checkpoint and then fetch blocks backwards from that point until the desired data can be verified. It is a relatively inexpensive sync from a cpu perspective because it only checks the block hashes and verifies the proposer signatures along the way.

## Syncing Lodestar

The implementation of the different syncing styles in Lodestar are actually one of two types under the hood, range sync and unknown-parent sync. Range sync is used when the start point of syncing is known. In the case of historical and checkpoint sync the starting points are well defined, genesis and the last finalized epoch boundary. Snapshot sync is not supported by Lodestar. If the starting point for sync is not known Lodestar must first determine where the starting point is. While the discussion about how that happens is out of scope for this document, the gist is that the beacon node will listen to gossipsub for blocks being broadcast on the network. It will also request [`MetaData`](https://github.com/ethereum/consensus-specs/blob/dev/specs/phase0/p2p-interface.md#getmetadata) from its peers and use that to start requesting the correct blocks from the network.

There are several flags that can be used to configure the sync process.

- [`--checkpointSyncUrl`](./beacon-cli.md#-checkpointsyncurl)
- [`--checkpointState`](./beacon-cli.md#-checkpointstate)
- [`--wssCheckpoint`](./beacon-cli.md#-wsscheckpoint)
- [`--forceCheckpointSync`](./beacon-cli.md#-forcecheckpointsync)
