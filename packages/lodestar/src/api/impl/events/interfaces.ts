import {LodestarEventIterator} from "../../../util/events";
import {BeaconEvent, BeaconEventType} from "./types";

export interface IEventsApi {
  getEventStream(topics: BeaconEventType[]): LodestarEventIterator<BeaconEvent>;
}
