import {SubcommitteeIndex, Slot, ValidatorIndex, RootHex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * SyncCommittee signatures are only useful during a single slot according to our peer's clocks
 */
const MAX_SLOTS_IN_CACHE = 3;

/** ValidataorSubnetKey = `validatorIndex + subcommitteeIndex` */
type ValidatorSubnetKey = string;

/**
 * Cache seen SyncCommitteeMessage by slot + validator index.
 */
export class SeenSyncCommitteeMessages {
  private readonly seenCacheBySlot = new MapDef<Slot, Map<ValidatorSubnetKey, RootHex>>(() => new Map());

  /**
   * based on slot + validator index
   */
  get(slot: Slot, subnet: SubcommitteeIndex, validatorIndex: ValidatorIndex): RootHex | null {
    const root = this.seenCacheBySlot.getOrDefault(slot).get(seenCacheKey(subnet, validatorIndex));
    return root ?? null;
  }

  /** Register item as seen in the cache */
  add(slot: Slot, subnet: SubcommitteeIndex, validatorIndex: ValidatorIndex, root: RootHex): void {
    this.seenCacheBySlot.getOrDefault(slot).set(seenCacheKey(subnet, validatorIndex), root);
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

function seenCacheKey(subnet: number, validatorIndex: ValidatorIndex): ValidatorSubnetKey {
  return `${subnet}-${validatorIndex}`;
}
