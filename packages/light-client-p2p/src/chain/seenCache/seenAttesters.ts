import {Epoch, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

// The next, current and previous epochs. We require the next epoch due to the
// `MAXIMUM_GOSSIP_CLOCK_DISPARITY`. We require the previous epoch since the
// specification delcares:
//
// ```
// aggregate.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE
//      >= current_slot >= aggregate.data.slot
// ```
//
// This means that during the current epoch we will always accept an attestation
// from at least one slot in the previous epoch.
const MAX_EPOCHS = 3;

/**
 * Keeps a cache to filter unaggregated attestations from the same validator in the same epoch.
 */
export class SeenAttesters {
  protected readonly validatorIndexesByEpoch = new MapDef<Epoch, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  protected lowestPermissibleEpoch: Epoch = 0;

  isKnown(targetEpoch: Epoch, validatorIndex: ValidatorIndex): boolean {
    return this.validatorIndexesByEpoch.get(targetEpoch)?.has(validatorIndex) === true;
  }

  add(targetEpoch: Epoch, validatorIndex: ValidatorIndex): void {
    if (targetEpoch < this.lowestPermissibleEpoch) {
      throw Error(`EpochTooLow ${targetEpoch} < ${this.lowestPermissibleEpoch}`);
    }

    this.validatorIndexesByEpoch.getOrDefault(targetEpoch).add(validatorIndex);
  }

  prune(currentEpoch: Epoch): void {
    this.lowestPermissibleEpoch = Math.max(currentEpoch - MAX_EPOCHS, 0);
    for (const epoch of this.validatorIndexesByEpoch.keys()) {
      if (epoch < this.lowestPermissibleEpoch) {
        this.validatorIndexesByEpoch.delete(epoch);
      }
    }
  }
}

/**
 * Keeps a cache to filter aggregated attestations from the same aggregators in the same epoch
 */
export class SeenAggregators extends SeenAttesters {}
