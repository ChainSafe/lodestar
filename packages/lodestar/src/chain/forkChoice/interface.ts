/**
 * @module chain/forkChoice
 */

import {Gwei, Hash, Slot, ValidatorIndex,} from "@chainsafe/eth2.0-types";


export interface ILMDGHOST {
  addBlock(slot: Slot, blockRootBuf: Hash, parentRootBuf: Hash): void;
  start(genesisTime: number): void;
  addAttestation(blockRootBuf: Hash, attester: ValidatorIndex, weight: Gwei): void;
  setFinalized(blockRoot: Hash): void;
  setJustified(blockRoot: Hash): void;
  head(): Hash;
}
