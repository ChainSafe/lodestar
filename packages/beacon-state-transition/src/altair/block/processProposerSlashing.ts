import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateAltair} from "../../types.js";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block/index.js";

export function processProposerSlashing(
  state: CachedBeaconStateAltair,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(ForkName.altair, state, proposerSlashing, verifySignatures);
}
