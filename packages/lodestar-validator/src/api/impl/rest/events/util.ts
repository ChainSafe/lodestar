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
        message: deserializeEventData(config.types.BlockEventPayload, msg.data),
      };
    case BeaconEventType.CHAIN_REORG:
      return {
        type: BeaconEventType.CHAIN_REORG,
        message: deserializeEventData(config.types.ChainReorg, msg.data),
      };
    default:
      throw new Error("Unsupported beacon event type " + msg.type);
  }
}

function deserializeEventData<T extends BeaconEvent["message"]>(type: ContainerType<T>, data: string): T {
  return type.fromJson(JSON.parse(data));
}

export async function pipeToEmitter(
  stream: IStoppableEventIterable<BeaconEvent>,
  emitter: ApiClientEventEmitter
): Promise<void> {
  for await (const evt of stream) {
    //I have no idea how to type this.
    // I've tried conditional typing but it didn't work
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    emitter.emit(evt.type, evt.message);
  }
}
