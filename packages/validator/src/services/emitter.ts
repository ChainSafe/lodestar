import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {Slot} from "@lodestar/types";
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
}) {
  /**
   * Wait for the first block to come with slot >= provided slot.
   */
  async waitForBlockSlot(slot: Slot): Promise<void> {
    let headListener: (head: HeadEventData) => void;

    const onDone = (): void => {
      this.off(ValidatorEvent.chainHead, headListener);
    };

    return new Promise((resolve) => {
      headListener = (head: HeadEventData): void => {
        if (head.slot >= slot) {
          onDone();
          resolve();
        }
      };
      this.on(ValidatorEvent.chainHead, headListener);
    });
  }
}
