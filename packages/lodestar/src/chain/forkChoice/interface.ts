/**
 * @module chain/forkChoice
 */

import {Gwei, Slot, ValidatorIndex, Checkpoint, Root,} from "@chainsafe/eth2.0-types";


export interface ILMDGHOST {
  start(genesisTime: number): Promise<void>;
  stop(): Promise<void>;
  addBlock(slot: Slot, blockRootBuf: Root, parentRootBuf: Root, justifiedCheckpoint: Checkpoint,
    finalizedCheckpoint: Checkpoint): void;
  addAttestation(blockRootBuf: Root, attester: ValidatorIndex, weight: Gwei): void;
  head(): Root;
  getJustified(): Checkpoint;
  getFinalized(): Checkpoint;
}
