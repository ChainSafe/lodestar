import {readonlyValues} from "@chainsafe/ssz";
import {bellatrix} from "@chainsafe/lodestar-types";

import {CachedBeaconStateAltair, CachedBeaconStateBellatrix, CachedBeaconStateAllForks} from "../../types";
import {processProposerSlashing} from "./processProposerSlashing";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processAttestations} from "../../altair/block/processAttestation";
import {processDeposit} from "../../altair/block/processDeposit";
import {processVoluntaryExit} from "../../altair/block/processVoluntaryExit";
import {MAX_DEPOSITS} from "@chainsafe/lodestar-params";

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

  for (const proposerSlashing of readonlyValues(body.proposerSlashings)) {
    processProposerSlashing(state, proposerSlashing, verifySignatures);
  }
  for (const attesterSlashing of readonlyValues(body.attesterSlashings)) {
    processAttesterSlashing(state, attesterSlashing, verifySignatures);
  }

  processAttestations(
    (state as CachedBeaconStateAllForks) as CachedBeaconStateAltair,
    Array.from(readonlyValues(body.attestations)),
    verifySignatures
  );

  for (const deposit of readonlyValues(body.deposits)) {
    processDeposit((state as CachedBeaconStateAllForks) as CachedBeaconStateAltair, deposit);
  }
  for (const voluntaryExit of readonlyValues(body.voluntaryExits)) {
    processVoluntaryExit(
      (state as CachedBeaconStateAllForks) as CachedBeaconStateAltair,
      voluntaryExit,
      verifySignatures
    );
  }
}
