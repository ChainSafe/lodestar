import {List, readOnlyForEach} from "@chainsafe/ssz";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlockBody,
  Deposit,
  ProposerSlashing,
  VoluntaryExit,
} from "@chainsafe/lodestar-types";

import {processProposerSlashing} from "./processProposerSlashing";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processAttestation} from "./processAttestation";
import {processDeposit} from "./processDeposit";
import {processVoluntaryExit} from "./processVoluntaryExit";
import {CachedBeaconState} from "../util/cachedBeaconState";

type Operation = ProposerSlashing | AttesterSlashing | Attestation | Deposit | VoluntaryExit;
type OperationFunction = (cachedState: CachedBeaconState, op: Operation, verify: boolean) => void;

export function processOperations(
  cachedState: CachedBeaconState,
  body: BeaconBlockBody,
  verifySignatures = true
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits
  const maxDeposits = Math.min(
    cachedState.config.params.MAX_DEPOSITS,
    cachedState.eth1Data.depositCount - cachedState.eth1DepositIndex
  );
  if (body.deposits.length !== maxDeposits) {
    throw new Error(
      "Block contains incorrect number of deposits: " + `depositCount=${body.deposits.length} expected=${maxDeposits}`
    );
  }

  ([
    [body.proposerSlashings, processProposerSlashing],
    [body.attesterSlashings, processAttesterSlashing],
    [body.attestations, processAttestation],
    [body.deposits, processDeposit],
    [body.voluntaryExits, processVoluntaryExit],
  ] as [List<Operation>, OperationFunction][]).forEach(([operations, processOp]) => {
    readOnlyForEach(operations, (op) => {
      processOp(cachedState, op, verifySignatures);
    });
  });
}
