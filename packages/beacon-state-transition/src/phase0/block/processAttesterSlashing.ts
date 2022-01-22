import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {BeaconStateCachedPhase0, BeaconStateCachedAllForks} from "../../types";
import {processAttesterSlashing as processAttesterSlashingAllForks} from "../../allForks/block";

export function processAttesterSlashing(
  state: BeaconStateCachedPhase0,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(
    ForkName.phase0,
    state as BeaconStateCachedAllForks,
    attesterSlashing,
    verifySignatures
  );
}
