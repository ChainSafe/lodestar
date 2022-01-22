import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {BeaconStateCachedAltair, BeaconStateCachedAllForks} from "../../types";
import {processAttesterSlashing as processAttesterSlashingAllForks} from "../../allForks/block";

export function processAttesterSlashing(
  state: BeaconStateCachedAltair,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(
    ForkName.altair,
    state as BeaconStateCachedAllForks,
    attesterSlashing,
    verifySignatures
  );
}
