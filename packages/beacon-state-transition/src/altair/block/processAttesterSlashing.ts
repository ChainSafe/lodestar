import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateAltair} from "../../types.js";
import {processAttesterSlashing as processAttesterSlashingAllForks} from "../../allForks/block/index.js";

export function processAttesterSlashing(
  state: CachedBeaconStateAltair,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(ForkName.altair, state, attesterSlashing, verifySignatures);
}
