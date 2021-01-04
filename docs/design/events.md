## Beacon Chain Events

|chain
|---
| see [IChainEvents](https://github.com/ChainSafe/lodestar/blob/a6ed7cce230e77cecc9b1fb9dad003f995e622f9/packages/lodestar/src/chain/emitter.ts#L107)

|network
|---
| see [INetworkEvents](https://github.com/ChainSafe/lodestar/blob/a6ed7cce230e77cecc9b1fb9dad003f995e622f9/packages/lodestar/src/network/interface.ts#L41)

|network.gossip
|---
|see [IGossipEvents](https://github.com/ChainSafe/lodestar/blob/a6ed7cce230e77cecc9b1fb9dad003f995e622f9/packages/lodestar/src/network/gossip/interface.ts#L24)

|network.reqResp
|---
|`"request", ReqRespRequest<RequestBody>`

|sync
|---
|`"syncCompleted"`

## Event Emitter
```mermaid
classDiagram

    LibP2pNetwork-->BeaconReqRespHandler:"peer:connect":handhake
    
    Chain-->api:attestation": handleBeaconAttestationEvent
    Chain-->BeaconSync:"error:block":onUnknownBlockRoot
    Chain-->NaiveRegularSync:"error:block":onErrorBlock
    Chain-->BlockRangeProcessor:"error:block":onErrorBlock
    Chain-->TasksService:"forkChoice:finalized":onFinalizedCheckpoint
    Chain-->api:"forkChoice:reorg":handleChainReorgEvent
    Chain-->api:"forkChoice:head":handleBeaconHeadEvent
    Chain-->LocalClock:"clock:slot":onSlot
    Chain-->Gossip:"forkVersion":handleForkVersion
    Chain-->Metadata:"forkVersion":handleForkVersion
    Chain-->BeaconGossipHandler:"forkVersion":handleForkVersion
    Chain-->FastSync:"checkpoint":checkSyncCompleted
    Chain-->TasksService:"checkpoint":onCheckpoint
    
    Chain-->BeaconApi:"block":push
    Chain-->EventsApi:"block":handleBeaconBlockEvent
    Chain-->EventsApi:"block":handleVoluntaryExitEvent
    Chain-->FastSync:"block":checkSyncProgress
    Chain-->NaiveRegularSync:"block":onProcessedBlock
    Chain-->ORARegularSync:"block":onProcessedBlock
    Chain-->BlockRangeProcessor:"block":onProcessedBlock
    Chain-->SyncStats:"block":onBlockProcessed
    
    Chain-->InteropSubnetsJoiningTask:"forkVersion":handleForkVersion
    Chain-->AttestationCollector:"clock:slot":checkDuties
    
    ReqResp-->BeaconReqRespHandler:"request"->onRequest
    
    NaiveRegularSync-->BeaconSync:"syncCompleted":syncCompleted
    
    Gossip-->TasksService:"gossip:start":handleGossipStart
    Gossip-->TasksService:"gossip:stop":handleGossipStop
    
    class Chain {
        "attestation",
        "block",
        "checkpoint",
        "justified",
        "finalized",
        "forkVersion",
        "clock:slot",
        "clock:epoch",
        "forkChoice:head",
        "forkChoice:reorg",
        "forkChoice:justified",
        "forkChoice:finalized",
        "error:attestation",
        "error:block",
    }
    
    class AttestationCollector {
    
    }
    
    class Metadata {
    
    }
    
    class LocalClock {
    
    }
    
    class api {
        +handleBeaconAttestationEvent
    }
    
    class ReqResp {
        "request"
    }
 
    class BeaconReqRespHandler {
        +this.onRequest()
        +this.handshake()
    }
      
    class LibP2pNetwork {
        +"peer:connect"
        +"peer:disconnect"
    }
    
    class TasksService {
    
    }

    class Gossip {

    }
    
    class NaiveRegularSync {
        (and ORARegularSync)
    }
    
    class BeaconSync {
        +this.syncCompleted()
    }
    
      
```