import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ContainerType} from "@chainsafe/ssz";
import {BeaconEvent, BeaconEventType} from "./types";

export function deserializeBeaconEventMessage(config: IBeaconConfig, msg: MessageEvent): BeaconEvent {
    switch (msg.type) {
        case BeaconEventType.BLOCK:
            return {
                type: BeaconEventType.BLOCK,
                message: deserializeEventData(config.types.BlockEventPayload, msg.data)
            };
        case BeaconEventType.CHAIN_REORG:
            return {
                type: BeaconEventType.CHAIN_REORG,
                message: deserializeEventData(config.types.ChainReorg, msg.data)
            };
        default:
            throw new Error("Unsupported beacon event type " + msg.type)
    }
}

function deserializeEventData<T extends BeaconEvent["message"]>(type: ContainerType<T>, data: string): T {
    return type.fromJson(JSON.parse(data));
}
