import {bytes32, Root, Gwei, Slot, ValidatorIndex} from "../types";


export interface LMDGHOST {
  addBlock(slot: Slot, blockRootBuf: bytes32, parentRootBuf: bytes32): void;
  addAttestation(blockRootBuf: bytes32, attester: ValidatorIndex, weight: Gwei): void;
  setFinalized(blockRoot: bytes32): void;
  setJustified(blockRoot: bytes32): void;
  head(): bytes32;
}
