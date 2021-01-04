## Beacon Chain Events

|chain
|---
|`"unknownBlockRoot", Hash`
|`"processedAttestation", Attestation`
|`"processedBlock", BeaconBlock`
|`"justifiedCheckpoint", Checkpoint`
|`"finalizedCheckpoint", Checkpoint`

|eth1
|---
|`"eth1Data", Eth1Data`
|`"deposit", number, Deposit`

|network
|---
|`"peer:connect", PeerInfo`
|`"peer:disconnect", PeerInfo`

|network.gossip
|---
|`blockTopic(), BeaconBlock`
|`attestationTopic(), Attestation`
|`shardAttestationTopic(), Attestation`
|`"gossipsub:heartbeat"`

|network.reqResp
|---
|`"request", PeerInfo, Method, RequestId, RequestBody`

## Event Emitter
![](https://i.imgur.com/85WDZ9Z.png)
