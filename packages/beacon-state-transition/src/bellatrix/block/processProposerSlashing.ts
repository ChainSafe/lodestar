import {allForks, bellatrix, phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState} from "../../allForks/util";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block";

export function processProposerSlashing(
  state: CachedBeaconState<bellatrix.BeaconState>,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(
    ForkName.bellatrix,
    state as CachedBeaconState<allForks.BeaconState>,
    proposerSlashing,
    verifySignatures
  );
}
