import assert from "assert";

import {
  BeaconBlock,
  BeaconState,
} from "../../../types";

import processAttestations from "./attestations";
import processAttesterSlashings from "./attesterSlashings";
import processDeposits from "./deposits";
import processEth1Data from "./eth1Data";
import processProposerSignature from "./proposerSignature";
import processProposerSlashings from "./proposerSlashings";
import processRandao from "./randao";
import processTransfers from "./transfers";
import processVoluntaryExits from "./voluntaryExits";

export default function processBlock(state: BeaconState, block: BeaconBlock): void {
  // Slot
  assert(block.slot === state.slot, "block root must equal state root");

  // Proposer signature
  processProposerSignature(state, block);

  // RANDAO
  processRandao(state, block);

  // Eth1 Data
  processEth1Data(state, block);

  // Transactions

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
}
