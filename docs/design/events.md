## Beacon Chain Events

Much of the design of Lodestar is based around events being emitted which are listened by various modules across the code. Below are the events (categorized according to which submodule the events are emitted from) and how they are listened for across the codebase.

### Chain

#### Event Descriptions
see [here](https://github.com/ChainSafe/lodestar/blob/a6ed7cce230e77cecc9b1fb9dad003f995e622f9/packages/lodestar/src/chain/emitter.ts#L10) for list of chain events

#### Who's listening?
| Event | Listener |
|---|---|
| "attestation" | `EventsApi->getEventStream` |
| "block" | `BeaconApi->getBlockStream` |
| "block" | `EventsApi->getEventStream` |
| "block" | `EventsApi->getEventStream` |
| "block" | `FastSync->start` |
| "block" | `ORARegularSync->start` |
| "block" | `SyncStats->start` |
| "checkpoint" | `FastSync->start` |
| "checkpoint" | `TasksService->start` |
| "clock:slot" | `AttestationCollector->start` |
| "clock:slot" | `LocalClock->waitForSlot` |
| "error:block" | `BeaconSync->startRegularSync` |
| "forkChoice:finalized" | `TasksService->start` |
| "forkChoice:reorg" | `EventsApi->getEventStream` |
| "forkChoice:head" | `EventsApi->getEventStream` |
| "forkVersion" | `Gossip->start` |
| "forkVersion" | `Metadata->start` |
| "forkVersion" | `BeaconGossipHandler->start` |
| "forkVersion" | `InteropSubnetsJoiningTask->start` |

### network

#### Event Descriptions
see [here](https://github.com/ChainSafe/lodestar/blob/8bd9cc4bcd1526363cb9646a0633e9a782287b2f/packages/lodestar/src/network/interface.ts#L36) for list of network events

#### Who's listening?
| Event | Listener |
|---|---|
| "peer:connect" |  `BeaconReqRespHandler->start` |
| "peer:disconnect" | none |
| "gossip:start" | `TasksService->start` |
| "gossip:stop" | `TasksService->start` |

### sync

#### Event Descriptions

| Event | Description |
|---|---|
| "syncCompleted" | emitted when regular sync is complete  |

#### Who's listening?
| Event | Listener |
|---|---|
| "syncCompleted" | `BeaconSync->startRegularSync` |
