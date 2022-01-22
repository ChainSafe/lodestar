import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {BeaconStateCachedBellatrix, BeaconStateCachedAllForks} from "../../types";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block";

export function processProposerSlashing(
  state: BeaconStateCachedBellatrix,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(
    ForkName.bellatrix,
    state as BeaconStateCachedAllForks,
    proposerSlashing,
    verifySignatures
  );
}
