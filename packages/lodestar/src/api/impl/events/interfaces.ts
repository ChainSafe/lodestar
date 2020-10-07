import {BeaconEvent, BeaconEventType} from "./types";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";

export interface IEventsApi {
  getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent>;
}
