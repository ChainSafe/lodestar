import {altair} from "@chainsafe/lodestar-types";

import {CachedBeaconStateAltair} from "../../types.js";
import {processProposerSlashing} from "./processProposerSlashing.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processAttestations} from "./processAttestation.js";
import {processDeposit} from "./processDeposit.js";
import {processVoluntaryExit} from "./processVoluntaryExit.js";
import {MAX_DEPOSITS} from "@chainsafe/lodestar-params";

export function processOperations(
  state: CachedBeaconStateAltair,
  body: altair.BeaconBlockBody,
  verifySignatures = true
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits
  const maxDeposits = Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex);
  if (body.deposits.length !== maxDeposits) {
    throw new Error(
      `Block contains incorrect number of deposits: depositCount=${body.deposits.length} expected=${maxDeposits}`
    );
  }

  for (const proposerSlashing of body.proposerSlashings) {
    processProposerSlashing(state, proposerSlashing, verifySignatures);
  }
  for (const attesterSlashing of body.attesterSlashings) {
    processAttesterSlashing(state, attesterSlashing, verifySignatures);
  }

  processAttestations(state, body.attestations, verifySignatures);

  for (const deposit of body.deposits) {
    processDeposit(state, deposit);
  }
  for (const voluntaryExit of body.voluntaryExits) {
    processVoluntaryExit(state, voluntaryExit, verifySignatures);
  }
}
