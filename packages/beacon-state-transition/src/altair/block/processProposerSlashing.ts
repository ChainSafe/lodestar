import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../../allForks/util";
import {processProposerSlashingAllForks} from "../../phase0/block/processProposerSlashing";
import {ForkName} from "@chainsafe/lodestar-params";

export function processProposerSlashing(
  state: CachedBeaconState<altair.BeaconState>,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(
    ForkName.altair,
    state as CachedBeaconState<allForks.BeaconState>,
    proposerSlashing,
    verifySignatures
  );
}
