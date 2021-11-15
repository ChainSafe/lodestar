import {allForks, merge, phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState} from "../../allForks/util";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block";

export function processProposerSlashing(
  state: CachedBeaconState<merge.BeaconState>,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(
    ForkName.merge,
    state as CachedBeaconState<allForks.BeaconState>,
    proposerSlashing,
    verifySignatures
  );
}
