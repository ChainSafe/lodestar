import EventSource from "eventsource";
import {IStoppableEventIterable, LodestarEventIterator} from "@chainsafe/lodestar-utils";
import {HttpClient, urlJoin} from "../../util";
import {BeaconEvent, BeaconEventType, IApiClient} from "../interface";
import {ContainerType} from "@chainsafe/ssz";
import {ApiClientEventEmitter} from "../interface";
import {IBeaconSSZTypes} from "@chainsafe/lodestar-types";

// eslint-disable-next-line @typescript-eslint/naming-convention
export function EventsApi(types: IBeaconSSZTypes, client: HttpClient): IApiClient["events"] {
  const prefix = "/eth/v1/events";

  return {
    getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent> {
      const query = topics.map((topic) => `topics=${topic}`).join("&");
      const url = `${urlJoin(client.baseUrl, prefix)}?${query}`;

      const eventSource = new EventSource(url);
      return new LodestarEventIterator(({push}) => {
        for (const evt of [BeaconEventType.BLOCK, BeaconEventType.CHAIN_REORG, BeaconEventType.HEAD]) {
          eventSource.addEventListener(evt, ((event: MessageEvent) => {
            if (topics.includes(event.type as BeaconEventType)) {
              push(deserializeBeaconEventMessage(types, event));
            }
          }) as EventListener);
        }
        return () => {
          eventSource.close();
        };
      });
    },
  };
}

function deserializeBeaconEventMessage(types: IBeaconSSZTypes, msg: MessageEvent): BeaconEvent {
  switch (msg.type) {
    case BeaconEventType.BLOCK:
      return {
        type: BeaconEventType.BLOCK,
        message: deserializeEventData(types.phase0.BlockEventPayload, msg.data),
      };
    case BeaconEventType.CHAIN_REORG:
      return {
        type: BeaconEventType.CHAIN_REORG,
        message: deserializeEventData(types.phase0.ChainReorg, msg.data),
      };
    case BeaconEventType.HEAD:
      return {
        type: BeaconEventType.HEAD,
        message: deserializeEventData(types.phase0.ChainHead, msg.data),
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
