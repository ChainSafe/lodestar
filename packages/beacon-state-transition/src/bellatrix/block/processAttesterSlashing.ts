import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateBellatrix} from "../../types.js";
import {processAttesterSlashing as processAttesterSlashingAllForks} from "../../allForks/block/index.js";

export function processAttesterSlashing(
  state: CachedBeaconStateBellatrix,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(ForkName.bellatrix, state, attesterSlashing, verifySignatures);
}
