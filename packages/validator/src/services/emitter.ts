import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {HeadEventData} from "./chainHeaderTracker.js";

export enum ValidatorEvent {
  /**
   * This event signals that the node chain has a new head.
   */
  chainHead = "chainHead",
}

export interface IValidatorEvents {
  [ValidatorEvent.chainHead]: (head: HeadEventData) => void;
}

/**
 * Emit important validator events.
 */
export class ValidatorEventEmitter extends (EventEmitter as {
  new (): StrictEventEmitter<EventEmitter, IValidatorEvents>;
}) {}
