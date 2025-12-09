import {Epoch, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

// How many *non future* epochs we intend to keep for SeenAttesters.
// Pre and post deneb specs require us to accept attestations from current and
// previous epoch.
//
// Pre-deneb:
// - `attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= current_slot >= attestation.data.slot`
//
// Post-deneb:
// - `attestation.data.slot <= current_slot`
// - `compute_epoch_at_slot(attestation.data.slot) in (get_previous_epoch(state), get_current_epoch(state))`
//
// When factored in MAXIMUM_GOSSIP_CLOCK_DISPARITY, it is possible we keep 3 epochs of SeenAttesters:
// previous, current and future epoch. This constant is solely used to calculate `lowestPermissibleEpoch`
// which prunes anything older than it.
//
// Assuming we're at epoch 100 while all other nodes at epoch 99, they all accept attestations at epoch 98, 99.
// If MAX_RETAINED_EPOCH = 2 then our lowestPermissibleEpoch is 98 which is fine
//
// Assuming we're at epoch 99 while all other nodes at epoch 100, they all accept attestations at epoch 99, 100.
// If MAX_RETAINED_EPOCH = 2 then lowestPermissibleEpoch is 97 which is more than enough
const EPOCH_LOOKBACK_LIMIT = 2;

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
    this.lowestPermissibleEpoch = Math.max(currentEpoch - EPOCH_LOOKBACK_LIMIT, 0);
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

/**
 * Keeps a cache to filter payload attestations from the same attesters in the same epoch
 */
export class SeenPayloadAttesters extends SeenAttesters {}
