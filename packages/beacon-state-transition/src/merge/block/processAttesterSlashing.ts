import {allForks, merge, phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {CachedBeaconState} from "../../allForks/util";
import {processAttesterSlashing as processAttesterSlashingAllForks} from "../../allForks/block";

export function processAttesterSlashing(
  state: CachedBeaconState<merge.BeaconState>,
  attesterSlashing: phase0.AttesterSlashing,
  verifySignatures = true
): void {
  processAttesterSlashingAllForks(
    ForkName.merge,
    state as CachedBeaconState<allForks.BeaconState>,
    attesterSlashing,
    verifySignatures
  );
}
