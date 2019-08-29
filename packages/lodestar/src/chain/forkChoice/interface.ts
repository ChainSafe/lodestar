/**
 * @module chain/forkChoice
 */

import {bytes32, Gwei, Slot, ValidatorIndex,} from "@chainsafe/eth2.0-types";


export interface ILMDGHOST {
  addBlock(slot: Slot, blockRootBuf: bytes32, parentRootBuf: bytes32): void;
  addAttestation(blockRootBuf: bytes32, attester: ValidatorIndex, weight: Gwei): void;
  setFinalized(blockRoot: bytes32): void;
  setJustified(blockRoot: bytes32): void;
  head(): bytes32;
}
