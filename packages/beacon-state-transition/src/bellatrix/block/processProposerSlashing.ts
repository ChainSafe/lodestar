import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateBellatrix, CachedBeaconStateAllForks} from "../../types";
import {processProposerSlashing as processProposerSlashingAllForks} from "../../allForks/block";

export function processProposerSlashing(
  state: CachedBeaconStateBellatrix,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  processProposerSlashingAllForks(
    ForkName.bellatrix,
    state as CachedBeaconStateAllForks,
    proposerSlashing,
    verifySignatures
  );
}
