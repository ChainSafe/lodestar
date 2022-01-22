import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {BeaconStateCachedBellatrix, BeaconStateCachedAllForks} from "../../types";
import {processAttesterSlashing as processAttesterSlashingAllForks} from "../../allForks/block";

export function processAttesterSlashing(
  state: BeaconStateCachedBellatrix,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(
    ForkName.bellatrix,
    state as BeaconStateCachedAllForks,
    attesterSlashing,
    verifySignatures
  );
}
