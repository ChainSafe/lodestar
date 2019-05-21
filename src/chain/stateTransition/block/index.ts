/**
 * @module chain/stateTransition/block
 */

import {
  BeaconBlock,
  BeaconState,
} from "../../../types";

import processAttestations from "./attestations";
import processAttesterSlashings from "./attesterSlashings";
import processDeposits from "./deposits";
import processEth1Data from "./eth1Data";
import processBlockHeader from "./blockHeader";
import processProposerSlashings from "./proposerSlashings";
import processRandao from "./randao";
import processTransfers from "./transfers";
import processVoluntaryExits from "./voluntaryExits";
import verifyBlockStateRoot from "./rootVerification";

export function processBlock(state: BeaconState, block: BeaconBlock, verify: boolean = true): void {
  // block header
  processBlockHeader(state, block, verify);

  // RANDAO
  processRandao(state, block);

  // Eth1 Data
  processEth1Data(state, block);

  // Operations

  // Proposer slashings
  processProposerSlashings(state, block);

  // Attester slashings
  processAttesterSlashings(state, block);

  // Attestations
  processAttestations(state, block);

  // Deposits
  processDeposits(state, block);

  // Voluntary Exits
  processVoluntaryExits(state, block);

  // Transfers
  processTransfers(state, block);

  if(verify) {
    // Verify block stateRoot
    verifyBlockStateRoot(state, block);
  }
}
