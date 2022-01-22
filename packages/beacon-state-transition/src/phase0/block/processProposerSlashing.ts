import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStatePhase0, CachedBeaconStateAllForks} from "../../types";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block";

export function processProposerSlashing(
  state: CachedBeaconStatePhase0,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(
    ForkName.phase0,
    state as CachedBeaconStateAllForks,
    proposerSlashing,
    verifySignatures
  );
}
