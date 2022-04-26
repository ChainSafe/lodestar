import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {CachedBeaconStatePhase0} from "../../types";
import {processAttesterSlashing as processAttesterSlashingAllForks} from "../../allForks/block";

export function processAttesterSlashing(
  state: CachedBeaconStatePhase0,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(ForkName.phase0, state, attesterSlashing, verifySignatures);
}
