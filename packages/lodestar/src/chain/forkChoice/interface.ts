/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module chain/forkChoice
 */

import {Checkpoint, Gwei, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconClock} from "../clock/interface";


export interface ILMDGHOST {
  start(genesisTime: number, clock: IBeaconClock): Promise<void>;
  stop(): Promise<void>;
  addBlock(info: BlockHeadInfo): void;
  addAttestation(blockRootBuf: Uint8Array, attester: ValidatorIndex, weight: Gwei): void;
  head(): BlockHeadInfo;
  headBlockSlot(): Slot;
  headBlockRoot(): Uint8Array;
  headStateRoot(): Uint8Array;
  getJustified(): Checkpoint;
  getFinalized(): Checkpoint;
}

/*
 * Info of Block and Chain for forkchoice
 */
export interface BlockHeadInfo {
  slot: Slot;
  blockRootBuf: Uint8Array;
  parentRootBuf: Uint8Array;
  stateRootBuf: Uint8Array;
  justifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
}
