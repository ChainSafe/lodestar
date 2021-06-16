import {List, readonlyValues} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {MAX_DEPOSITS} from "@chainsafe/lodestar-params";

import {CachedBeaconState} from "../../allForks/util";
import {processProposerSlashing} from "./processProposerSlashing";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processAttestation} from "./processAttestation";
import {processDeposit} from "./processDeposit";
import {processVoluntaryExit} from "./processVoluntaryExit";
import {ValidatorExitProcess} from "../../allForks/block/initiateValidatorExit";

type Operation =
  | phase0.ProposerSlashing
  | phase0.AttesterSlashing
  | phase0.Attestation
  | phase0.Deposit
  | phase0.VoluntaryExit;
type OperationFunction = (
  state: CachedBeaconState<phase0.BeaconState>,
  op: Operation,
  verify: boolean,
  process: ValidatorExitProcess
) => void;

export function processOperations(
  state: CachedBeaconState<phase0.BeaconState>,
  body: phase0.BeaconBlockBody,
  verifySignatures = true
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits
  const maxDeposits = Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex);
  if (body.deposits.length !== maxDeposits) {
    throw new Error(
      "Block contains incorrect number of deposits: " + `depositCount=${body.deposits.length} expected=${maxDeposits}`
    );
  }

  // cache some internal data of validator exit process after the 1st exit
  const validatorExitProcess = {} as ValidatorExitProcess;

  for (const [operations, processOp] of [
    [body.proposerSlashings, processProposerSlashing],
    [body.attesterSlashings, processAttesterSlashing],
    [body.attestations, processAttestation],
    [body.deposits, processDeposit],
    [body.voluntaryExits, processVoluntaryExit],
  ] as [List<Operation>, OperationFunction][]) {
    for (const op of readonlyValues(operations)) {
      processOp(state, op, verifySignatures, validatorExitProcess);
    }
  }
}
