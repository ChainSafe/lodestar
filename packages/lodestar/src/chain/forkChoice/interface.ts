/**
 * @module chain/forkChoice
 */

import {
  Hash,
  Gwei,
  Slot,
  ValidatorIndex,
} from "@chainsafe/eth2.0-types";


export interface LMDGHOST {
  addBlock(slot: Slot, blockRootBuf: Hash, parentRootBuf: Hash): void;
  addAttestation(blockRootBuf: Hash, attester: ValidatorIndex, weight: Gwei): void;
  setFinalized(blockRoot: Hash): void;
  setJustified(blockRoot: Hash): void;
  head(): Hash;
}
