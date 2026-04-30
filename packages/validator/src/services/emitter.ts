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
  /**
   * [Heze] Signals that the execution payload was fully imported (EL accepted via newPayload,
   * fork-choice updated). At this point the EL has applied the payload and its mempool view is
   * post-slot, so the IL committee can build against it.
   */
  executionPayloadImported = "executionPayloadImported",
}

export type ExecutionPayloadAvailableEventData = {
  slot: Slot;
  blockRoot: string;
};

export type ExecutionPayloadImportedEventData = {
  slot: Slot;
  blockRoot: string;
};

export type ValidatorEvents = {
  [ValidatorEvent.chainHead]: (head: HeadEventData) => void;
  [ValidatorEvent.executionPayloadAvailable]: (payload: ExecutionPayloadAvailableEventData) => void;
  [ValidatorEvent.executionPayloadImported]: (payload: ExecutionPayloadImportedEventData) => void;
};

/**
 * Emit important validator events.
 */
export class ValidatorEventEmitter extends (EventEmitter as {
  new (): StrictEventEmitter<EventEmitter, ValidatorEvents>;
}) {
  /** Highest slot for which `executionPayloadImported` has fired (TOCTOU short-circuit). */
  private highestImportedPayloadSlot: Slot = -1;

  constructor() {
    super();
    this.on(ValidatorEvent.executionPayloadImported, (payload) => {
      if (payload.slot > this.highestImportedPayloadSlot) {
        this.highestImportedPayloadSlot = payload.slot;
      }
    });
  }

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

  /**
   * [Heze] Wait for the first execution-payload-imported event with slot >= provided slot.
   * Short-circuits if such an event has already been observed before this call (TOCTOU-safe).
   */
  async waitForExecutionPayloadImportedSlot(slot: Slot): Promise<void> {
    if (this.highestImportedPayloadSlot >= slot) return;

    let payloadListener: (payload: ExecutionPayloadImportedEventData) => void;
    const onDone = (): void => {
      this.off(ValidatorEvent.executionPayloadImported, payloadListener);
    };
    return new Promise((resolve) => {
      payloadListener = (payload): void => {
        if (payload.slot >= slot) {
          onDone();
          resolve();
        }
      };
      this.on(ValidatorEvent.executionPayloadImported, payloadListener);
    });
  }
}
