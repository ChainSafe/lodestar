import {BeaconBlockBody, BeaconState} from "../../../types";
import assert from "assert";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS, MAX_TRANSFERS,
  MAX_VOLUNTARY_EXITS
} from "../../../constants";
import processProposerSlashing from "./proposerSlashings";
import processAttesterSlashing from "./attesterSlashings";
import processAttestation from "./attestations";
import processDeposit from "./deposits";
import {processVoluntaryExit} from "./voluntaryExits";
import {processTransfer} from "./transfers";


// SPEC 0.7
// def process_operations(state: BeaconState, body: BeaconBlockBody) -> None:
//   # Verify that outstanding deposits are processed up to the maximum number of deposits
// assert len(body.deposits) == min(MAX_DEPOSITS, state.latest_eth1_data.deposit_count - state.deposit_index)
// # Verify that there are no duplicate transfers
// assert len(body.transfers) == len(set(body.transfers))
//
// for operations, max_operations, function in (
//   (body.proposer_slashings, MAX_PROPOSER_SLASHINGS, process_proposer_slashing),
//     (body.attester_slashings, MAX_ATTESTER_SLASHINGS, process_attester_slashing),
//     (body.attestations, MAX_ATTESTATIONS, process_attestation),
//     (body.deposits, MAX_DEPOSITS, process_deposit),
//     (body.voluntary_exits, MAX_VOLUNTARY_EXITS, process_voluntary_exit),
//     (body.transfers, MAX_TRANSFERS, process_transfer),
// ):
// assert len(operations) <= max_operations
// for operation in operations:
// function(state, operation)

export function processOperations(state: BeaconState, body: BeaconBlockBody): void {
  // Verify that outstanding deposits are processed up to the maximum number of deposits
  assert(body.deposits.length == Math.min(MAX_DEPOSITS,
    state.latestEth1Data.depositCount - state.depositIndex));
  // Verify that there are no duplicate transfers
  assert(body.transfers.length == (new Set(body.transfers)).size);
  let operationArray = [
    {operations:body.proposerSlashings, maxOperations:MAX_PROPOSER_SLASHINGS,
      func: processProposerSlashing},
    {operations:body.attesterSlashings, maxOperations:MAX_ATTESTER_SLASHINGS,
      func: processAttesterSlashing},
    {operations:body.attestations, maxOperations:MAX_ATTESTATIONS, func: processAttestation},
    {operations:body.deposits, maxOperations:MAX_DEPOSITS, func: processDeposit},
    {operations:body.voluntaryExits, maxOperations:MAX_VOLUNTARY_EXITS, func: processVoluntaryExit},
    {operations:body.transfers, maxOperations:MAX_TRANSFERS, func: processTransfer},
  ];
  operationArray.forEach(({operations, maxOperations, func})=>{
    assert(operations.length <= maxOperations);
    operations.forEach((operation)=>{
      func(state, operation);
    });
  });
}