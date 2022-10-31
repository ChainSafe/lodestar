import {SubcommitteeIndex, Slot, ValidatorIndex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * SyncCommittee signatures are only useful during a single slot according to our peer's clocks
 */
const MAX_SLOTS_IN_CACHE = 3;

/** ValidataorSubnetKey = `validatorIndex + subcommitteeIndex` */
type ValidataorSubnetKey = string;

/**
 * Cache seen SyncCommitteeMessage by slot + validator index.
 */
export class SeenSyncCommitteeMessages {
  private readonly seenCacheBySlot = new MapDef<Slot, Set<ValidataorSubnetKey>>(() => new Set<ValidataorSubnetKey>());

  /**
   * based on slot + validator index
   */
  isKnown(slot: Slot, subnet: SubcommitteeIndex, validatorIndex: ValidatorIndex): boolean {
    return this.seenCacheBySlot.get(slot)?.has(seenCacheKey(subnet, validatorIndex)) === true;
  }

  /** Register item as seen in the cache */
  add(slot: Slot, subnet: SubcommitteeIndex, validatorIndex: ValidatorIndex): void {
    this.seenCacheBySlot.getOrDefault(slot).add(seenCacheKey(subnet, validatorIndex));
  }

  /** Prune per clock slot */
  prune(clockSlot: Slot): void {
    for (const slot of this.seenCacheBySlot.keys()) {
      if (slot < clockSlot - MAX_SLOTS_IN_CACHE) {
        this.seenCacheBySlot.delete(slot);
      }
    }
  }
}

function seenCacheKey(subnet: number, validatorIndex: ValidatorIndex): ValidataorSubnetKey {
  return `${subnet}-${validatorIndex}`;
}
