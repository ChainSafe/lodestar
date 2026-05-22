import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, Slot, ValidatorIndex} from "@lodestar/types";
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
 * Maximum number of slots retained in the per-slot dedup map for PayloadAttestationMessage.
 *
 * Gossip validation enforces `data.slot == current_slot` (with MAXIMUM_GOSSIP_CLOCK_DISPARITY),
 * so we only need a small window around the current slot. Mirrors `SeenSyncCommitteeMessages`.
 */
const PAYLOAD_ATTESTER_MAX_SLOTS_IN_CACHE = 3;

/**
 * Caches for PayloadAttestationMessage gossip. Two parallel structures, written atomically
 * by `add(slot, validatorIndex)`:
 *
 *  - `validatorIndexesBySlot` — per-slot dedup. The gloas spec requires "first valid message
 *    received from the validator with index `validator_index`", and the validator emits ONE
 *    message per slot regardless of how many PTC seats it holds (multi-seat fan-out happens
 *    at pool aggregation, see `payloadAttestationPool`). A second message from the same
 *    validator at the same slot conflicts on `payload_present`/`blob_data_available` and
 *    must be IGNORED. Same validator at a *different* slot in the same epoch is independent
 *    and must be accepted.
 *
 *  - `validatorIndexesByEpoch` — per-epoch liveness signal consumed by `validatorSeenAtEpoch`
 *    for the validator liveness API, which queries epochs in `currentEpoch-1 .. currentEpoch+1`.
 */
export class SeenPayloadAttesters {
  private readonly validatorIndexesBySlot = new MapDef<Slot, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  private readonly validatorIndexesByEpoch = new MapDef<Epoch, Set<ValidatorIndex>>(() => new Set<ValidatorIndex>());
  private lowestPermissibleEpoch: Epoch = 0;

  isKnown(slot: Slot, validatorIndex: ValidatorIndex): boolean {
    return this.validatorIndexesBySlot.get(slot)?.has(validatorIndex) === true;
  }

  isKnownAtEpoch(epoch: Epoch, validatorIndex: ValidatorIndex): boolean {
    return this.validatorIndexesByEpoch.get(epoch)?.has(validatorIndex) === true;
  }

  add(slot: Slot, validatorIndex: ValidatorIndex): void {
    const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
    if (epoch < this.lowestPermissibleEpoch) {
      throw Error(`EpochTooLow ${epoch} < ${this.lowestPermissibleEpoch}`);
    }
    this.validatorIndexesBySlot.getOrDefault(slot).add(validatorIndex);
    this.validatorIndexesByEpoch.getOrDefault(epoch).add(validatorIndex);
  }

  prune(clockSlot: Slot): void {
    for (const slot of this.validatorIndexesBySlot.keys()) {
      if (slot < clockSlot - PAYLOAD_ATTESTER_MAX_SLOTS_IN_CACHE) {
        this.validatorIndexesBySlot.delete(slot);
      }
    }
  }

  pruneEpoch(currentEpoch: Epoch): void {
    this.lowestPermissibleEpoch = Math.max(currentEpoch - EPOCH_LOOKBACK_LIMIT, 0);
    for (const epoch of this.validatorIndexesByEpoch.keys()) {
      if (epoch < this.lowestPermissibleEpoch) {
        this.validatorIndexesByEpoch.delete(epoch);
      }
    }
  }
}
