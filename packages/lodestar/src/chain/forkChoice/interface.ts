/**
 * @module chain/forkChoice
 */

import {Gwei, ValidatorIndex, Checkpoint} from "@chainsafe/lodestar-types";
import {BlockChainInfo} from "./statefulDag/interface";


export interface ILMDGHOST {
  start(genesisTime: number): Promise<void>;
  stop(): Promise<void>;
  addBlock(info: BlockChainInfo): void;
  addAttestation(blockRootBuf: Uint8Array, attester: ValidatorIndex, weight: Gwei): void;
  head(): Uint8Array;
  headStateRoot(): Uint8Array;
  getJustified(): Checkpoint;
  getFinalized(): Checkpoint;
}
