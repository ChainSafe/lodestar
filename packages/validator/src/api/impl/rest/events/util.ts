import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ContainerType} from "@chainsafe/ssz";
import {BeaconEvent, BeaconEventType} from "../../../interface/events";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";
import {ApiClientEventEmitter} from "../../../interface";

export function deserializeBeaconEventMessage(config: IBeaconConfig, msg: MessageEvent): BeaconEvent {
  switch (msg.type) {
    case BeaconEventType.BLOCK:
      return {
        type: BeaconEventType.BLOCK,
        message: deserializeEventData(config.types.phase0.BlockEventPayload, msg.data),
      };
    case BeaconEventType.CHAIN_REORG:
      return {
        type: BeaconEventType.CHAIN_REORG,
        message: deserializeEventData(config.types.phase0.ChainReorg, msg.data),
      };
    case BeaconEventType.HEAD:
      return {
        type: BeaconEventType.HEAD,
        message: deserializeEventData(config.types.phase0.ChainHead, msg.data),
      };
    default:
      throw new Error("Unsupported beacon event type " + msg.type);
  }
}

function deserializeEventData<T extends BeaconEvent["message"]>(type: ContainerType<T>, data: string): T {
  return type.fromJson(JSON.parse(data));
}

export async function pipeToEmitter<
  T extends BeaconEvent["type"] = BeaconEventType.BLOCK | BeaconEventType.HEAD | BeaconEventType.CHAIN_REORG
>(stream: IStoppableEventIterable<BeaconEvent>, emitter: ApiClientEventEmitter): Promise<void> {
  for await (const evt of stream) {
    emitter.emit<BeaconEvent["type"], ApiClientEventEmitter>(
      evt.type,
      evt.message as ({type: T} extends BeaconEvent ? BeaconEvent : never)["message"]
    );
  }
}
