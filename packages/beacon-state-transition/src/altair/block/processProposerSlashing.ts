import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {BeaconStateCachedAltair, BeaconStateCachedAllForks} from "../../allForks/util";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block";

export function processProposerSlashing(
  state: BeaconStateCachedAltair,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(
    ForkName.altair,
    state as BeaconStateCachedAllForks,
    proposerSlashing,
    verifySignatures
  );
}
