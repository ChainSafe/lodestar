import {BitArray} from "@chainsafe/ssz";
import {CommitteeIndex, RootHex, Slot, phase0} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {InsertOutcome} from "../opPools/types.js";

export type SeenAttDataKey = AttDataBase64;
// AttestationData is used to cache attestations
type AttDataBase64 = string;

export type AttestationDataCacheEntry = {
  // part of shuffling data, so this does not take memory
  committeeValidatorIndices: Uint32Array;
  committeeIndex: CommitteeIndex;
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

// For pre-electra, there is no committeeIndex in SingleAttestation, so we hard code it to 0
// AttDataBase64 has committeeIndex instead
export const PRE_ELECTRA_SINGLE_ATTESTATION_COMMITTEE_INDEX = 0;

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
 * Cached seen AttestationData to improve gossip validation. For Electra, this still take into account attestationIndex
 * even through it is moved outside of AttestationData.
 * As of April 2023, validating gossip attestation takes ~12% of cpu time for a node subscribing to all subnets on mainnet.
 * Having this cache help saves a lot of cpu time since most of the gossip attestations are on the same slot.
 */
export class SeenAttestationDatas {
  private cacheEntryByAttDataByIndexBySlot = new MapDef<
    Slot,
    MapDef<CommitteeIndex, Map<AttDataBase64, AttestationDataCacheEntry>>
  >(
    () =>
      new MapDef<CommitteeIndex, Map<AttDataBase64, AttestationDataCacheEntry>>(
        () => new Map<AttDataBase64, AttestationDataCacheEntry>()
      )
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

  /**
   * Add an AttestationDataCacheEntry to the cache.
   * - preElectra: add(slot, PRE_ELECTRA_SINGLE_ATTESTATION_COMMITTEE_INDEX, attDataBase64, cacheEntry)
   * - electra: add(slot, committeeIndex, attDataBase64, cacheEntry)
   */
  add(
    slot: Slot,
    committeeIndex: CommitteeIndex,
    attDataBase64: AttDataBase64,
    cacheEntry: AttestationDataCacheEntry
  ): InsertOutcome {
    if (slot < this.lowestPermissibleSlot) {
      this.metrics?.seenCache.attestationData.reject.inc({reason: RejectReason.too_old});
      return InsertOutcome.Old;
    }

    const cacheEntryByAttDataByIndex = this.cacheEntryByAttDataByIndexBySlot.getOrDefault(slot);
    const cacheEntryByAttData = cacheEntryByAttDataByIndex.getOrDefault(committeeIndex);
    if (cacheEntryByAttData.has(attDataBase64)) {
      this.metrics?.seenCache.attestationData.reject.inc({reason: RejectReason.already_known});
      return InsertOutcome.AlreadyKnown;
    }

    if (cacheEntryByAttData.size >= this.maxCacheSizePerSlot) {
      this.metrics?.seenCache.attestationData.reject.inc({reason: RejectReason.reached_limit});
      return InsertOutcome.ReachLimit;
    }

    cacheEntryByAttData.set(attDataBase64, cacheEntry);
    return InsertOutcome.NewData;
  }

  /**
   * Get an AttestationDataCacheEntry from the cache.
   * - preElectra: get(slot, PRE_ELECTRA_SINGLE_ATTESTATION_COMMITTEE_INDEX, attDataBase64)
   * - electra: get(slot, committeeIndex, attDataBase64)
   */
  get(slot: Slot, committeeIndex: CommitteeIndex, attDataBase64: SeenAttDataKey): AttestationDataCacheEntry | null {
    const cacheEntryByAttDataByIndex = this.cacheEntryByAttDataByIndexBySlot.get(slot);
    const cacheEntryByAttData = cacheEntryByAttDataByIndex?.get(committeeIndex);
    const cacheEntry = cacheEntryByAttData?.get(attDataBase64);
    if (cacheEntry) {
      this.metrics?.seenCache.attestationData.hit.inc();
    } else {
      this.metrics?.seenCache.attestationData.miss.inc();
    }
    return cacheEntry ?? null;
  }

  onSlot(clockSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(clockSlot - this.cacheSlotDistance, 0);
    for (const slot of this.cacheEntryByAttDataByIndexBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.cacheEntryByAttDataByIndexBySlot.delete(slot);
      }
    }
  }

  private onScrapeLodestarMetrics(metrics: Metrics): void {
    metrics?.seenCache.attestationData.totalSlot.set(this.cacheEntryByAttDataByIndexBySlot.size);
    // tracking number of attestation data at current slot may not be correct if scrape time is not at the end of slot
    // so we track it at the previous slot
    const previousSlot = this.lowestPermissibleSlot + this.cacheSlotDistance - 1;
    const cacheEntryByAttDataByIndex = this.cacheEntryByAttDataByIndexBySlot.get(previousSlot);
    let count = 0;
    for (const cacheEntryByAttDataBase64 of cacheEntryByAttDataByIndex?.values() ?? []) {
      count += cacheEntryByAttDataBase64.size;
    }
    metrics?.seenCache.attestationData.countPerSlot.set(count);
  }
}
