/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module chain/forkChoice
 */

import {Checkpoint, Gwei, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconClock} from "../clock/interface";


export interface ILMDGHOST {
  start(genesisTime: number, clock: IBeaconClock): Promise<void>;
  stop(): Promise<void>;
  addBlock(info: BlockSummary): void;
  addAttestation(blockRootBuf: Uint8Array, attester: ValidatorIndex, weight: Gwei): void;
  head(): BlockSummary;
  headBlockSlot(): Slot;
  headBlockRoot(): Uint8Array;
  headStateRoot(): Uint8Array;
  getJustified(): Checkpoint;
  getFinalized(): Checkpoint;
}

/*
 * Info of Block and Chain for forkchoice
 */
export interface BlockSummary {
  slot: Slot;
  blockRoot: Uint8Array;
  parentRoot: Uint8Array;
  stateRoot: Uint8Array;
  justifiedCheckpoint: Checkpoint;
  finalizedCheckpoint: Checkpoint;
}
