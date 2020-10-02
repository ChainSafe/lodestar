import EventSource from "eventsource";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IStoppableEventIterable, LodestarEventIterator} from "@chainsafe/lodestar-utils";

import {urlJoin} from "../../../../util";
import {deserializeBeaconEventMessage} from "./util";
import {BeaconEvent, BeaconEventEmitter, BeaconEventType, IEventsApi} from "../../../interface/events";
import {BlockEventPayload} from "@chainsafe/lodestar-types";

export class RestEventsApi implements IEventsApi {
  private readonly config: IBeaconConfig;
  private readonly baseUrl: string;

  public constructor(config: IBeaconConfig, baseUrl: string) {
    this.config = config;
    this.baseUrl = baseUrl;
  }

  public getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent> {
    const eventSource = new EventSource(
      urlJoin(this.baseUrl, "/v1/events?" + topics.map((topic) => `topics=${topic}`).join("&"))
    );
    return new LodestarEventIterator(({push}) => {
      eventSource.onmessage = (event) => {
        if (topics.includes(event.type as BeaconEventType)) {
          push(deserializeBeaconEventMessage(this.config, event));
        }
      };
      return () => {
        eventSource.close();
      };
    });
  }
}

export async function pipeToEmitter(
  stream: IStoppableEventIterable<BeaconEvent>,
  emitter: BeaconEventEmitter
): Promise<void> {
  for await (const evt of stream) {
    emitter.emit(evt.type as BeaconEventType.BLOCK, evt.message as BlockEventPayload);
  }
}
