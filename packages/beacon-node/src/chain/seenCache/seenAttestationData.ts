import {CachedBeaconStateAllForks, ISignatureSet} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {Metrics} from "../../metrics/metrics.js";
import {AttDataHash} from "../../util/sszBytes.js";

export type AttestationDataCacheEntry = {
  state: CachedBeaconStateAllForks;
  committeeIndices: number[];
  signatureSet: ISignatureSet;
  subnet: number;
};

/**
 * There are maximum 64 committees per slot, asuming 1 committee may have up to 3 different data due to some nodes
 * are not up to date, we can have up to 192 different attestation data per slot.
 * TODO: check memory cost of this cache, do we need the state there?
 */
const MAX_CACHE_SIZE = 200;

/**
 * As of April 2023, validating gossip attestation takes ~12% of cpu time for a node subscribing to all subnets on mainnet.
 * Having this cache help saves a lot of cpu time since most of the gossip attestations are on the same slot.
 */
export class SeenAttestationDatas {
  private cacheEntryByAttDataHash = new Map<AttDataHash, AttestationDataCacheEntry>();

  constructor(private slot: Slot, private readonly metrics: Metrics | null) {
    metrics?.seenCache.attestationData.total.addCollect(() => this.onScrapeLodestarMetrics(metrics));
  }

  add(attDataHash: AttDataHash, cacheEntry: AttestationDataCacheEntry): void {
    if (this.cacheEntryByAttDataHash.has(attDataHash)) {
      return;
    }

    if (this.cacheEntryByAttDataHash.size >= MAX_CACHE_SIZE) {
      this.metrics?.seenCache.attestationData.reject.inc();
      return;
    }

    this.cacheEntryByAttDataHash.set(attDataHash, cacheEntry);
  }

  get(attDataHash: AttDataHash): AttestationDataCacheEntry | null {
    const cacheEntry = this.cacheEntryByAttDataHash.get(attDataHash);
    if (cacheEntry) {
      this.metrics?.seenCache.attestationData.hit.inc();
    } else {
      this.metrics?.seenCache.attestationData.miss.inc();
    }
    return cacheEntry ?? null;
  }

  onSlot(slot: Slot): void {
    if (this.slot < slot) {
      this.cacheEntryByAttDataHash = new Map();
    }
    this.slot = slot;
  }

  private onScrapeLodestarMetrics(metrics: Metrics): void {
    metrics?.seenCache.attestationData.total.set(this.cacheEntryByAttDataHash.size);
  }
}
