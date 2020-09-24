import {LodestarEventIterator} from "../../../util/events";
import {BeaconEvent} from "./types";

export interface IEventsApi {
  getEventStream(): LodestarEventIterator<BeaconEvent>;
}
