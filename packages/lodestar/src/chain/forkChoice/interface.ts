/**
 * @module chain/forkChoice
 */

import {Gwei, Slot, ValidatorIndex, Checkpoint} from "@chainsafe/eth2.0-types";


export interface ILMDGHOST {
  start(genesisTime: number): Promise<void>;
  stop(): Promise<void>;
  addBlock(
    slot: Slot,
    blockRootBuf: Uint8Array,
    parentRootBuf: Uint8Array,
    justifiedCheckpoint: Checkpoint,
    finalizedCheckpoint: Checkpoint
  ): void;
  addAttestation(blockRootBuf: Uint8Array, attester: ValidatorIndex, weight: Gwei): void;
  head(): Uint8Array;
  getJustified(): Checkpoint;
  getFinalized(): Checkpoint;
}
