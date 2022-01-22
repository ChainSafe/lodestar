import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {BeaconStateCachedPhase0, BeaconStateCachedAllForks} from "../../allForks/util";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block";

export function processProposerSlashing(
  state: BeaconStateCachedPhase0,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(
    ForkName.phase0,
    state as BeaconStateCachedAllForks,
    proposerSlashing,
    verifySignatures
  );
}
