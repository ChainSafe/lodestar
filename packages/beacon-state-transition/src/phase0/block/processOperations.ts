import {List, readonlyValues} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {MAX_DEPOSITS} from "@chainsafe/lodestar-params";

import {CachedBeaconStatePhase0} from "../../types";
import {processProposerSlashing} from "./processProposerSlashing";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processAttestation} from "./processAttestation";
import {processDeposit} from "./processDeposit";
import {processVoluntaryExit} from "./processVoluntaryExit";

type Operation =
  | phase0.ProposerSlashing
  | phase0.AttesterSlashing
  | phase0.Attestation
  | phase0.Deposit
  | phase0.VoluntaryExit;
type OperationFunction = (state: CachedBeaconStatePhase0, op: Operation, verify: boolean) => void;

export function processOperations(
  state: CachedBeaconStatePhase0,
  body: phase0.BeaconBlockBody,
  verifySignatures = true
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits
  const maxDeposits = Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex);
  if (body.deposits.length !== maxDeposits) {
    throw new Error(
      `Block contains incorrect number of deposits: depositCount=${body.deposits.length} expected=${maxDeposits}`
    );
  }

  for (const [operations, processOp] of [
    [body.proposerSlashings, processProposerSlashing],
    [body.attesterSlashings, processAttesterSlashing],
    [body.attestations, processAttestation],
    [body.deposits, processDeposit],
    [body.voluntaryExits, processVoluntaryExit],
  ] as [List<Operation>, OperationFunction][]) {
    for (const op of readonlyValues(operations)) {
      processOp(state, op, verifySignatures);
    }
  }
}
