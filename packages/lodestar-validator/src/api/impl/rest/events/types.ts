import {BlockEventPayload, ChainReorg} from "@chainsafe/lodestar-types";

export enum BeaconEventType {
  BLOCK = "block",
  CHAIN_REORG = "chain_reorg",
}

export type BeaconBlockEvent = {
  type: typeof BeaconEventType.BLOCK;
  message: BlockEventPayload;
};

export type BeaconChainReorgEvent = {
  type: typeof BeaconEventType.CHAIN_REORG;
  message: ChainReorg;
};

export type BeaconEvent = BeaconBlockEvent | BeaconChainReorgEvent;
