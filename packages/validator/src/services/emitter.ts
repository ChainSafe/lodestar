import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {Slot} from "@lodestar/types";
import {HeadEventData} from "./chainHeaderTracker.js";

export enum ValidatorEvent {
  /**
   * This event signals that the node chain has a new head.
   */
  chainHead = "chainHead",
  /**
   * This event signals that an execution payload and blobs are available for payload attestation.
   */
  executionPayloadAvailable = "executionPayloadAvailable",
}

export type ExecutionPayloadAvailableEventData = {
  slot: Slot;
  blockRoot: string;
};

export type ValidatorEvents = {
  [ValidatorEvent.chainHead]: (head: HeadEventData) => void;
  [ValidatorEvent.executionPayloadAvailable]: (payload: ExecutionPayloadAvailableEventData) => void;
};

/**
 * Emit important validator events.
 */
export class ValidatorEventEmitter extends (EventEmitter as {
  new (): StrictEventEmitter<EventEmitter, ValidatorEvents>;
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

  /**
   * Wait for the first execution payload availability event to come with slot >= provided slot.
   */
  async waitForExecutionPayloadAvailableSlot(slot: Slot): Promise<void> {
    let payloadListener: (payload: ExecutionPayloadAvailableEventData) => void;

    const onDone = (): void => {
      this.off(ValidatorEvent.executionPayloadAvailable, payloadListener);
    };

    return new Promise((resolve) => {
      payloadListener = (payload): void => {
        if (payload.slot >= slot) {
          onDone();
          resolve();
        }
      };
      this.on(ValidatorEvent.executionPayloadAvailable, payloadListener);
    });
  }
}
