/**
 * @module chain/forkChoice
 */

import {Gwei, Hash, Slot, ValidatorIndex, Checkpoint,} from "@chainsafe/eth2.0-types";


export interface ILMDGHOST {
  start(genesisTime: number): Promise<void>;
  addBlock(slot: Slot, blockRootBuf: Hash, parentRootBuf: Hash, justifiedCheckpoint: Checkpoint,
    finalizedCheckpoint: Checkpoint): void;
  addAttestation(blockRootBuf: Hash, attester: ValidatorIndex, weight: Gwei): void;
  head(): Hash;
}
