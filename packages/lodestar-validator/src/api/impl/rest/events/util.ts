import {BeaconEvent, BeaconEventType} from "@chainsafe/lodestar/lib/api/impl/events";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ContainerType} from "@chainsafe/ssz";

export function deserializeBeaconEventMessage(config: IBeaconConfig, msg: MessageEvent): BeaconEvent {
    switch (msg.type) {
        case BeaconEventType.BLOCK:
            return {
                type: BeaconEventType.BLOCK,
                message: deserializeEventData(config.types.BlockEventPayload, msg.data)
            };
        case BeaconEventType.ATTESTATION:
            return {
                type: BeaconEventType.ATTESTATION,
                message: deserializeEventData(config.types.Attestation, msg.data)
            };
        case BeaconEventType.CHAIN_REORG:
            return {
                type: BeaconEventType.CHAIN_REORG,
                message: deserializeEventData(config.types.ChainReorg, msg.data)
            };
        case BeaconEventType.FINALIZED_CHECKPOINT:
            return {
                type: BeaconEventType.FINALIZED_CHECKPOINT,
                message: deserializeEventData(config.types.FinalizedCheckpoint, msg.data)
            };
        case BeaconEventType.HEAD:
            return {
                type: BeaconEventType.HEAD,
                message: deserializeEventData(config.types.ChainHead, msg.data)
            };
        case BeaconEventType.VOLUNTARY_EXIT:
            return {
                type: BeaconEventType.VOLUNTARY_EXIT,
                message: deserializeEventData(config.types.SignedVoluntaryExit, msg.data)
            };
        default:
            throw new Error("Unsupported beacon event type " + msg.type)
    }
}

function deserializeEventData<T extends BeaconEvent["message"]>(type: ContainerType<T>, data: string): T {
    return type.fromJson(JSON.parse(data));
}
