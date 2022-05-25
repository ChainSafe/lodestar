import {bellatrix} from "@chainsafe/lodestar-types";
import {MAX_DEPOSITS} from "@chainsafe/lodestar-params";

import {CachedBeaconStateBellatrix, CachedBeaconStateAltair, CachedBeaconStateAllForks} from "../../types.js";
import {processProposerSlashing} from "./processProposerSlashing.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processAttestations} from "../../altair/block/processAttestation.js";
import {processDeposit} from "../../altair/block/processDeposit.js";
import {processVoluntaryExit} from "../../altair/block/processVoluntaryExit.js";

export function processOperations(
  state: CachedBeaconStateBellatrix,
  body: bellatrix.BeaconBlockBody,
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

  processAttestations(
    (state as CachedBeaconStateAllForks) as CachedBeaconStateAltair,
    body.attestations,
    verifySignatures
  );

  for (const deposit of body.deposits) {
    processDeposit((state as CachedBeaconStateAllForks) as CachedBeaconStateAltair, deposit);
  }
  for (const voluntaryExit of body.voluntaryExits) {
    processVoluntaryExit(
      (state as CachedBeaconStateAllForks) as CachedBeaconStateAltair,
      voluntaryExit,
      verifySignatures
    );
  }
}
