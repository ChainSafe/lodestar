import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconStateBellatrix, CachedBeaconStateAllForks} from "../../types";
import {processAttesterSlashing as processAttesterSlashingAllForks} from "../../allForks/block";

export function processAttesterSlashing(
  state: CachedBeaconStateBellatrix,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(
    ForkName.bellatrix,
    state as CachedBeaconStateAllForks,
    attesterSlashing,
    verifySignatures
  );
}
