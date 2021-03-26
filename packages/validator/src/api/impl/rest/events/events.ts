import EventSource from "eventsource";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IStoppableEventIterable, LodestarEventIterator} from "@chainsafe/lodestar-utils";
import {urlJoin} from "../../../../util";
import {deserializeBeaconEventMessage} from "./util";
import {BeaconEvent, BeaconEventType, IEventsApi} from "../../../interface/events";

export class RestEventsApi implements IEventsApi {
  private readonly config: IBeaconConfig;
  private readonly baseUrl: string;

  constructor(config: IBeaconConfig, baseUrl: string) {
    this.config = config;
    this.baseUrl = baseUrl;
  }

  getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent> {
    const eventSource = new EventSource(
      urlJoin(this.baseUrl, "/eth/v1/events?" + topics.map((topic) => `topics=${topic}`).join("&"))
    );
    return new LodestarEventIterator(({push}) => {
      for (const evt of [BeaconEventType.BLOCK, BeaconEventType.CHAIN_REORG, BeaconEventType.HEAD]) {
        eventSource.addEventListener(evt, ((event: MessageEvent) => {
          if (topics.includes(event.type as BeaconEventType)) {
            push(deserializeBeaconEventMessage(this.config, event));
          }
        }) as EventListener);
      }
      return () => {
        eventSource.close();
      };
    });
  }
}
