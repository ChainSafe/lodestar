import {readonlyValues} from "@chainsafe/ssz";
import {altair} from "@chainsafe/lodestar-types";

import {CachedBeaconState} from "../../allForks/util";
import {processProposerSlashing} from "./processProposerSlashing";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processAttestations} from "./processAttestation";
import {processDeposit} from "./processDeposit";
import {processVoluntaryExit} from "./processVoluntaryExit";
import {MAX_DEPOSITS} from "@chainsafe/lodestar-params";
import {BlockProcess} from "../../util/blockProcess";

export function processOperations(
  state: CachedBeaconState<altair.BeaconState>,
  body: altair.BeaconBlockBody,
  blockProcess: BlockProcess,
  verifySignatures = true
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits
  const maxDeposits = Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex);
  if (body.deposits.length !== maxDeposits) {
    throw new Error(
      `Block contains incorrect number of deposits: depositCount=${body.deposits.length} expected=${maxDeposits}`
    );
  }

  for (const proposerSlashing of readonlyValues(body.proposerSlashings)) {
    processProposerSlashing(state, proposerSlashing, blockProcess, verifySignatures);
  }
  for (const attesterSlashing of readonlyValues(body.attesterSlashings)) {
    processAttesterSlashing(state, attesterSlashing, blockProcess, verifySignatures);
  }

  processAttestations(state, Array.from(readonlyValues(body.attestations)), blockProcess, verifySignatures);

  for (const deposit of readonlyValues(body.deposits)) {
    processDeposit(state, deposit);
  }
  for (const voluntaryExit of readonlyValues(body.voluntaryExits)) {
    processVoluntaryExit(state, voluntaryExit, blockProcess, verifySignatures);
  }
}
