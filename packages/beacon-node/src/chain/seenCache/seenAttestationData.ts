import {Index2PubkeyCache} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {AttDataHash} from "../../util/sszBytes.js";

export type AttestationDataCacheEntry = {
  // shared across application so this does not take memory
  index2pubkey: Index2PubkeyCache;
  // part of shuffling data, so this does not take memory
  committeeIndices: number[];
  // IndexedAttestationData signing root, 32 bytes
  signingRoot: Uint8Array;
  // to be consumed by forkchoice
  attDataRootHex: RootHex;
  subnet: number;
};

enum RejectReason {
  // attestation data reaches MAX_CACHE_SIZE_PER_SLOT
  reached_limit = "reached_limit",
  // attestation data is too old
  too_old = "too_old",
}

/**
 * There are maximum 64 committees per slot, asuming 1 committee may have up to 3 different data due to some nodes
 * are not up to date, we can have up to 192 different attestation data per slot.
 */
const MAX_CACHE_SIZE_PER_SLOT = 200;

/**
 * It takes less than 300kb to cache 200 attestation data per slot, so we can cache 3 slots worth of attestation data.
 */
const DEFAULT_CACHE_SLOT_DISTANCE = 2;

// TODO: unit test
/**
 * As of April 2023, validating gossip attestation takes ~12% of cpu time for a node subscribing to all subnets on mainnet.
 * Having this cache help saves a lot of cpu time since most of the gossip attestations are on the same slot.
 */
export class SeenAttestationDatas {
  private cacheEntryByAttDataHashBySlot = new MapDef<Slot, Map<AttDataHash, AttestationDataCacheEntry>>(
    () => new Map<AttDataHash, AttestationDataCacheEntry>()
  );
  private lowestPermissibleSlot = 0;

  constructor(
    private readonly cacheSlotDistance = DEFAULT_CACHE_SLOT_DISTANCE,
    private readonly metrics: Metrics | null
  ) {
    metrics?.seenCache.attestationData.total.addCollect(() => this.onScrapeLodestarMetrics(metrics));
  }

  add(slot: Slot, attDataHash: AttDataHash, cacheEntry: AttestationDataCacheEntry): void {
    if (slot < this.lowestPermissibleSlot) {
      this.metrics?.seenCache.attestationData.reject.inc({reason: RejectReason.too_old});
      return;
    }

    const cacheEntryByAttDataHash = this.cacheEntryByAttDataHashBySlot.getOrDefault(slot);
    if (cacheEntryByAttDataHash.has(attDataHash)) {
      return;
    }

    if (cacheEntryByAttDataHash.size >= MAX_CACHE_SIZE_PER_SLOT) {
      this.metrics?.seenCache.attestationData.reject.inc({reason: RejectReason.reached_limit});
      return;
    }

    cacheEntryByAttDataHash.set(attDataHash, cacheEntry);
  }

  get(slot: Slot, attDataHash: AttDataHash): AttestationDataCacheEntry | null {
    const cacheEntryByAttDataHash = this.cacheEntryByAttDataHashBySlot.getOrDefault(slot);
    const cacheEntry = cacheEntryByAttDataHash.get(attDataHash);
    if (cacheEntry) {
      this.metrics?.seenCache.attestationData.hit.inc();
    } else {
      this.metrics?.seenCache.attestationData.miss.inc();
    }
    return cacheEntry ?? null;
  }

  onSlot(clockSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(clockSlot - this.cacheSlotDistance, 0);
    for (const slot of this.cacheEntryByAttDataHashBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.cacheEntryByAttDataHashBySlot.delete(slot);
      }
    }
  }

  private onScrapeLodestarMetrics(metrics: Metrics): void {
    metrics?.seenCache.attestationData.total.set(this.cacheEntryByAttDataHashBySlot.size);
  }
}
