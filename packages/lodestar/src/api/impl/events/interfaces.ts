import {BeaconEvent, BeaconEventType} from "./types";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";

export interface IEventsApi {
  /**
   * Returns a mapping of beacon node events to an iteratable event stream.
   */
  getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent>;
}
