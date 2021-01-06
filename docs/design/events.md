## Beacon Chain Events

Much of the design of Lodestar is based around events being emitted which are listened by various modules across the code. Below are the events (categorized according to which submodule the events are emitted from) and how they are listened for across the codebase.

### Chain

#### Event Descriptions
see [here](https://github.com/ChainSafe/lodestar/blob/a6ed7cce230e77cecc9b1fb9dad003f995e622f9/packages/lodestar/src/chain/emitter.ts#L10) for list of chain events

#### Who's listening?
| Event | Listener |
|---|---|
| "attestation" | `EventsApi->handleBeaconAttestationEvent` |
| "block" | `BeaconApi->push` |
| "block" | `EventsApi->handleBeaconBlockEvent` |
| "block" | `EventsApi->handleVoluntaryExitEvent` |
| "block" | `FastSync->checkSyncProgress` |
| "block" | `NaiveRegularSync->onProcessedBlock` |
| "block" | `ORARegularSync->onProcessedBlock` |
| "block" | `BlockRangeProcessor->onProcessedBlock` |
| "block" | `SyncStats->onBlockProcessed` |
| "checkpoint" | `FastSync->checkSyncCompleted` |
| "checkpoint" | `TasksService->onCheckpoint` |
| "clock:slot" | `AttestationCollector->checkDuties` |
| "clock:slot" | `LocalClock->onSlot` |
| "error:block" | `BeaconSync->onUnknownBlockRoot` |
| "error:block" | `NaiveRegularSync->onErrorBlock` |
| "error:block" | `BlockRangeProcessor->onErrorBlock` |
| "forkChoice:finalized" | `TasksService->onFinalizedCheckpoint` |
| "forkChoice:reorg" | `EventsApi->handleChainReorgEvent` |
| "forkChoice:head" | `EventsApi->handleBeaconHeadEvent` |
| "forkVersion" | `Gossip->handleForkVersion` |
| "forkVersion" | `Metadata->handleForkVersion` |
| "forkVersion" | `BeaconGossipHandler->handleForkVersion` |
| "forkVersion" | `InteropSubnetsJoiningTask->handleForkVersion` |

### network

#### Event Descriptions
see [here](https://github.com/ChainSafe/lodestar/blob/a6ed7cce230e77cecc9b1fb9dad003f995e622f9/packages/lodestar/src/network/interface.ts#L41) for list of network events

#### Who's listening?
| Event | Listener |
|---|---|
| "peer:connect" |  `BeaconReqRespHandler->handshake` |
| "peer:disconnect" | none |

### network.gossip

see [here](https://github.com/ChainSafe/lodestar/blob/a6ed7cce230e77cecc9b1fb9dad003f995e622f9/packages/lodestar/src/network/gossip/interface.ts#L24) for a list of gossip events

#### Who's listening?
| Event | Listener |
|---|---|
| "gossip:start" | `TasksService->handleGossipStart` |
| "gossip:stop" | `TasksService->handleGossipStop` |

### network.reqResp

| Event | Description |
|---|---|
| "request" | emitted when an RPC request comes from the network |

#### Who's listening?
| Event | Listener |
|---|---|---|
| "request" | `BeaconReqRespHandler->onRequest` |

### sync

| Event | Description |
|---|---|
| "syncCompleted" | emitted when regular sync is complete  |

#### Who's listening?
| Event | Listener |
|---|---|
| "syncCompleted" | `BeaconSync->syncCompleted` |
