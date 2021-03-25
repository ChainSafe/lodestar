import {phase0} from "@chainsafe/lodestar-types";
import {IStoppableEventIterable} from "@chainsafe/lodestar-utils";

export enum BeaconEventType {
  BLOCK = "block",
  CHAIN_REORG = "chain_reorg",
  HEAD = "head",
}

export type BeaconBlockEvent = {
  type: typeof BeaconEventType.BLOCK;
  message: phase0.BlockEventPayload;
};

export type BeaconChainReorgEvent = {
  type: typeof BeaconEventType.CHAIN_REORG;
  message: phase0.ChainReorg;
};

export type HeadEvent = {
  type: typeof BeaconEventType.HEAD;
  message: phase0.ChainHead;
};

export type BeaconEvent = BeaconBlockEvent | BeaconChainReorgEvent | HeadEvent;

export interface IEventsApi {
  getEventStream(topics: BeaconEventType[]): IStoppableEventIterable<BeaconEvent>;
}
