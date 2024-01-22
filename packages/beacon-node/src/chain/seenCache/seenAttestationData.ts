import {phase0, RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {AttDataBase64} from "../../util/sszBytes.js";
import {InsertOutcome} from "../opPools/types.js";

export type AttestationDataCacheEntry = {
  // part of shuffling data, so this does not take memory
  committeeIndices: number[];
  // IndexedAttestationData signing root, 32 bytes
  signingRoot: Uint8Array;
  // to be consumed by forkchoice and oppool
  attDataRootHex: RootHex;
  // caching this for 3 slots take 600 instances max, this is nothing compared to attestations processed per slot
  // for example in a mainnet node subscribing to all subnets, attestations are processed up to 20k per slot
  attestationData: phase0.AttestationData;
  subnet: number;
};

export enum RejectReason {
  // attestation data reaches MAX_CACHE_SIZE_PER_SLOT
  reached_limit = "reached_limit",
  // attestation data is too old
  too_old = "too_old",
  // attestation data is already known
  already_known = "already_known",
}

/**
 * There are maximum 64 committees per slot, assuming 1 committee may have up to 3 different data due to some nodes
 * are not up to date, we can have up to 192 different attestation data per slot.
 */
const DEFAULT_MAX_CACHE_SIZE_PER_SLOT = 200;

/**
 * It takes less than 300kb to cache 200 attestation data per slot, so we can cache 3 slots worth of attestation data.
 */
const DEFAULT_CACHE_SLOT_DISTANCE = 2;

/**
 * As of April 2023, validating gossip attestation takes ~12% of cpu time for a node subscribing to all subnets on mainnet.
 * Having this cache help saves a lot of cpu time since most of the gossip attestations are on the same slot.
 */
export class SeenAttestationDatas {
  private cacheEntryByAttDataBase64BySlot = new MapDef<Slot, Map<AttDataBase64, AttestationDataCacheEntry>>(
    () => new Map<AttDataBase64, AttestationDataCacheEntry>()
  );
  private lowestPermissibleSlot = 0;

  constructor(
    private readonly metrics: Metrics | null,
    private readonly cacheSlotDistance = DEFAULT_CACHE_SLOT_DISTANCE,
    // mainly for unit test
    private readonly maxCacheSizePerSlot = DEFAULT_MAX_CACHE_SIZE_PER_SLOT
  ) {
    metrics?.seenCache.attestationData.totalSlot.addCollect(() => this.onScrapeLodestarMetrics(metrics));
  }

  // TODO: Move InsertOutcome type definition to a common place
  add(slot: Slot, attDataBase64: AttDataBase64, cacheEntry: AttestationDataCacheEntry): InsertOutcome {
    if (slot < this.lowestPermissibleSlot) {
      this.metrics?.seenCache.attestationData.reject.inc({reason: RejectReason.too_old});
      return InsertOutcome.Old;
    }

    const cacheEntryByAttDataBase64 = this.cacheEntryByAttDataBase64BySlot.getOrDefault(slot);
    if (cacheEntryByAttDataBase64.has(attDataBase64)) {
      this.metrics?.seenCache.attestationData.reject.inc({reason: RejectReason.already_known});
      return InsertOutcome.AlreadyKnown;
    }

    if (cacheEntryByAttDataBase64.size >= this.maxCacheSizePerSlot) {
      this.metrics?.seenCache.attestationData.reject.inc({reason: RejectReason.reached_limit});
      return InsertOutcome.ReachLimit;
    }

    cacheEntryByAttDataBase64.set(attDataBase64, cacheEntry);
    return InsertOutcome.NewData;
  }

  get(slot: Slot, attDataBase64: AttDataBase64): AttestationDataCacheEntry | null {
    const cacheEntryByAttDataBase64 = this.cacheEntryByAttDataBase64BySlot.get(slot);
    const cacheEntry = cacheEntryByAttDataBase64?.get(attDataBase64);
    if (cacheEntry) {
      this.metrics?.seenCache.attestationData.hit.inc();
    } else {
      this.metrics?.seenCache.attestationData.miss.inc();
    }
    return cacheEntry ?? null;
  }

  onSlot(clockSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(clockSlot - this.cacheSlotDistance, 0);
    for (const slot of this.cacheEntryByAttDataBase64BySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.cacheEntryByAttDataBase64BySlot.delete(slot);
      }
    }
  }

  private onScrapeLodestarMetrics(metrics: Metrics): void {
    metrics?.seenCache.attestationData.totalSlot.set(this.cacheEntryByAttDataBase64BySlot.size);
    // tracking number of attestation data at current slot may not be correct if scrape time is not at the end of slot
    // so we track it at the previous slot
    const previousSlot = this.lowestPermissibleSlot + this.cacheSlotDistance - 1;
    metrics?.seenCache.attestationData.countPerSlot.set(
      this.cacheEntryByAttDataBase64BySlot.get(previousSlot)?.size ?? 0
    );
  }
}
