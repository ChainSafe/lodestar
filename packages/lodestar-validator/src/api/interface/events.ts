import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {BlockEventPayload, ChainHead, ChainReorg} from "@chainsafe/lodestar-types";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";

export enum BeaconEventType {
  BLOCK = "block",
  CHAIN_REORG = "chain_reorg",
  HEAD = "head",
  CLOCK_SLOT = "clock_slot",
  CLOCK_EPOCH = "clock_epoch",
}

export type BeaconBlockEvent = {
  type: typeof BeaconEventType.BLOCK;
  message: BlockEventPayload;
};

export type BeaconChainReorgEvent = {
  type: typeof BeaconEventType.CHAIN_REORG;
  message: ChainReorg;
};

export type HeadEvent = {
  type: typeof BeaconEventType.HEAD;
  message: ChainHead;
};

export type ClockSlotEvent = {
  type: typeof BeaconEventType.CLOCK_SLOT;
  message: {
    slot: number;
  };
};

export type ClockEpochEvent = {
  type: typeof BeaconEventType.CLOCK_EPOCH;
  message: {
    epoch: number;
  };
};

export type BeaconEvent = BeaconBlockEvent | BeaconChainReorgEvent | HeadEvent | ClockSlotEvent | ClockEpochEvent;

export interface IChainEvents {
  [BeaconEventType.BLOCK]: (evt: BeaconBlockEvent["message"]) => void;
  [BeaconEventType.CHAIN_REORG]: (evt: BeaconChainReorgEvent["message"]) => void;
  [BeaconEventType.HEAD]: (evt: HeadEvent["message"]) => void;
  [BeaconEventType.CLOCK_SLOT]: (evt: ClockSlotEvent["message"]) => void;
  [BeaconEventType.CLOCK_EPOCH]: (evt: ClockEpochEvent["message"]) => void;
}

export type BeaconEventEmitter = StrictEventEmitter<EventEmitter, IChainEvents>;

export interface IEventsApi {
  getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent>;
  getEventEmitter(topics: BeaconEventType[], signal: AbortSignal): BeaconEventEmitter;
}
