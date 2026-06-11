import {ApiClient, routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {GENESIS_SLOT} from "@lodestar/params";
import {Root, RootHex, Slot} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {ValidatorEvent, ValidatorEventEmitter} from "./emitter.js";

const {EventType} = routes.events;

export type HeadEventData = {
  slot: Slot;
  head: RootHex;
  previousDutyDependentRoot: RootHex;
  currentDutyDependentRoot: RootHex;
};

export type ExecutionPayloadAvailableEventData = {
  slot: Slot;
  blockRoot: RootHex;
};

type RunEveryFn = (event: HeadEventData) => Promise<void>;

/**
 * Track the head slot/root using the event stream api "head".
 */
export class ChainHeaderTracker {
  private headBlockSlot: Slot = GENESIS_SLOT;
  private headBlockRoot: Root | null = null;
  private readonly fns: RunEveryFn[] = [];

  constructor(
    private readonly config: BeaconConfig,
    private readonly logger: Logger,
    private readonly api: ApiClient,
    private readonly emitter: ValidatorEventEmitter
  ) {}

  start(signal: AbortSignal): void {
    this.logger.verbose("Subscribing to validator events");

    const topics = [EventType.head];
    // We wait until the gloas fork is configured to avoid breaking
    // connections with pre-gloas beacon nodes
    // Post-gloas BNs are required to support head_v2 per beacon-APIs#590,
    // so we assume any gloas-configured BN will accept this topic.
    if (this.config.GLOAS_FORK_EPOCH !== Infinity) {
      topics.push(EventType.headV2);
      topics.push(EventType.executionPayloadAvailable);
    }

    this.api.events
      .eventstream({
        topics,
        signal,
        onEvent: this.onEvent,
        onError: (e) => {
          this.logger.error("Failed to receive validator event", {}, e);
        },
        onClose: () => {
          this.logger.verbose("Closed stream for validator events", {});
        },
      })
      .catch((e) => this.logger.error("Failed to subscribe to validator events", {}, e));
  }

  getCurrentChainHead(slot: Slot): Root | null {
    if (slot >= this.headBlockSlot) {
      return this.headBlockRoot;
    }
    // We don't know head of an old block
    return null;
  }

  runOnNewHead(fn: RunEveryFn): void {
    this.fns.push(fn);
  }

  private onEvent = (event: routes.events.BeaconEvent): void => {
    // Use head_v2 instead when gloas is configured, as head is deprecated post-gloas
    if (event.type === EventType.head && this.config.GLOAS_FORK_EPOCH === Infinity) {
      const {message} = event;
      const {slot, block, previousDutyDependentRoot, currentDutyDependentRoot} = message;
      this.headBlockSlot = slot;
      this.headBlockRoot = fromHex(block);

      const headEventData = {
        slot: this.headBlockSlot,
        head: block,
        previousDutyDependentRoot: previousDutyDependentRoot,
        currentDutyDependentRoot: currentDutyDependentRoot,
      };

      for (const fn of this.fns) {
        fn(headEventData).catch((e) => this.logger.error("Error calling head event handler", e));
      }

      this.emitter.emit(ValidatorEvent.chainHead, headEventData);

      this.logger.verbose("Found new chain head", {
        slot: slot,
        head: block,
        previousDuty: previousDutyDependentRoot,
        currentDuty: currentDutyDependentRoot,
      });
    }

    if (event.type === EventType.headV2) {
      const {data} = event.message;
      const {slot, block, currentEpochDependentRoot, nextEpochDependentRoot} = data;
      this.headBlockSlot = slot;
      this.headBlockRoot = fromHex(block);

      const headEventData = {
        slot: this.headBlockSlot,
        head: block,
        previousDutyDependentRoot: currentEpochDependentRoot,
        currentDutyDependentRoot: nextEpochDependentRoot,
      };

      for (const fn of this.fns) {
        fn(headEventData).catch((e) => this.logger.error("Error calling head event handler", e));
      }

      this.emitter.emit(ValidatorEvent.chainHead, headEventData);

      this.logger.verbose("Found new chain head", {
        slot: slot,
        head: block,
        previousDuty: currentEpochDependentRoot,
        currentDuty: nextEpochDependentRoot,
      });
    }

    if (event.type === EventType.executionPayloadAvailable) {
      this.emitter.emit(ValidatorEvent.executionPayloadAvailable, event.message);

      this.logger.verbose("Found execution payload available", {
        slot: event.message.slot,
        blockRoot: event.message.blockRoot,
      });
    }
  };
}
