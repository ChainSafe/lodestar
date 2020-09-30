import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconEvent, BeaconEventType, IEventsApi} from "@chainsafe/lodestar/lib/api/impl/events";
import {IStoppableEventIterable, LodestarEventIterator} from "@chainsafe/lodestar/lib/util/events";
import EventSource from "eventsource";
import {urlJoin} from "../../../../util";
import {deserializeBeaconEventMessage} from "./util";

export class RestEventsApi implements IEventsApi {
    private readonly config: IBeaconConfig;
    private readonly baseUrl: string;

    public constructor(config: IBeaconConfig, baseUrl: string) {
        this.config = config;
        this.baseUrl = baseUrl;
    }

    public getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent> {
        const eventSource = new EventSource(
            urlJoin(
                this.baseUrl,
                "/v1/events?" + topics.map(topic => `topics=${topic}`).join("&")
            )
        );
        return new LodestarEventIterator(({push}) => {
            eventSource.onmessage = (event) => {
                if(topics.includes(event.type as BeaconEventType)) {
                    push(deserializeBeaconEventMessage(this.config, event));
                }
            }
            return () => {
                eventSource.close();
            }
        })
    }
}

