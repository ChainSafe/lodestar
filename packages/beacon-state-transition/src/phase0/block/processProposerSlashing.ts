import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStatePhase0} from "../../types.js";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block/index.js";

export function processProposerSlashing(
  state: CachedBeaconStatePhase0,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(ForkName.phase0, state, proposerSlashing, verifySignatures);
}
