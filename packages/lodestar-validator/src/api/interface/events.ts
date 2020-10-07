import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";
import {BeaconEvent, BeaconEventType} from "../impl/rest/events/types";

export interface IEventsApi {
  getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent>;
}
