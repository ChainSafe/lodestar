import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateBellatrix} from "../../types.js";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block/index.js";

export function processProposerSlashing(
  state: CachedBeaconStateBellatrix,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(ForkName.bellatrix, state, proposerSlashing, verifySignatures);
}
