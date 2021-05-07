import bls from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, phase0} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {List} from "@chainsafe/ssz";
import {NUM_SLOTS_IN_CACHE, slotRootKey, SlotRootKey} from "./repositories/utils/syncCommittee";

type AggregatedSyncCommitteeContribution = Omit<altair.SyncCommitteeContribution, "signature"> & {
  signatures: phase0.BLSSignature[];
};

/**
 * Preaggregate SyncCommitteeSignature into SyncCommitteeContribution
 * and cache seen SyncCommitteeSignature by slot + validator index.
 * This stays in-memory and should be pruned per slot.
 */
export class SeenSyncCommitteeCache {
  private readonly config: IBeaconConfig;

  /**
   * Each array item is respective to a subCommitteeIndex.
   * Preaggregate into SyncCommitteeContribution.
   * */
  private contributionCaches: Map<phase0.Slot, Map<SlotRootKey, AggregatedSyncCommitteeContribution>>[];

  /**
   * Each array item is respective to a subCommitteeIndex.
   * A seen SyncCommitteeSignature is decided by slot + validator index.
   */
  private seenCaches: Map<phase0.Slot, Set<phase0.ValidatorIndex>>[];

  constructor(config: IBeaconConfig) {
    this.config = config;
    this.contributionCaches = Array.from(
      {length: altair.SYNC_COMMITTEE_SUBNET_COUNT},
      () => new Map<phase0.Slot, Map<SlotRootKey, AggregatedSyncCommitteeContribution>>()
    );
    this.seenCaches = Array.from(
      {length: altair.SYNC_COMMITTEE_SUBNET_COUNT},
      () => new Map<phase0.Slot, Set<phase0.ValidatorIndex>>()
    );
  }

  addSyncCommitteeSignature(
    subCommitteeIndex: phase0.SubCommitteeIndex,
    syncCommitteeSignature: altair.SyncCommitteeSignature,
    indicesInSubSyncCommittee: number[] = []
  ): void {
    this.addToContributionCache(subCommitteeIndex, syncCommitteeSignature, indicesInSubSyncCommittee);
    this.addToSyncCache(subCommitteeIndex, syncCommitteeSignature);
  }

  /**
   * based on slot + validator index
   */
  hasSyncCommitteeSignature(
    subSyncCommitteeIndex: phase0.SubCommitteeIndex,
    syncCommittee: altair.SyncCommitteeSignature
  ): boolean {
    const seenCache = this.seenCaches[subSyncCommitteeIndex];
    const {slot, validatorIndex} = syncCommittee;
    const validatorIndices = seenCache.get(slot);
    if (validatorIndices) {
      return validatorIndices.has(validatorIndex);
    }
    return false;
  }

  /**
   * This is for the aggregator to produce ContributionAndProof.
   */
  getSyncCommitteeContribution(
    subCommitteeIndex: phase0.SubCommitteeIndex,
    slot: phase0.Slot,
    beaconBlockRoot: phase0.Root
  ): altair.SyncCommitteeContribution | null {
    const contributionCache = this.contributionCaches[subCommitteeIndex];
    const slotRootCache = contributionCache.get(slot);
    if (slotRootCache) {
      const key = slotRootKey({slot, beaconBlockRoot});
      const preAggregatedContribution = slotRootCache.get(key);
      if (preAggregatedContribution) {
        const signatures = preAggregatedContribution.signatures.map((signature) =>
          bls.Signature.fromBytes(signature.valueOf() as Uint8Array)
        );
        const aggregatedSignature = bls.Signature.aggregate(signatures).toBytes();
        return {
          ...preAggregatedContribution,
          signature: aggregatedSignature,
        };
      }
    }
    return null;
  }

  /**
   * Keep the last NUM_SLOTS_IN_CACHE recent slots
   */
  prune(): void {
    for (
      let subSyncCommitteeIndex = 0;
      subSyncCommitteeIndex < altair.SYNC_COMMITTEE_SUBNET_COUNT;
      subSyncCommitteeIndex++
    ) {
      const contributionCache = this.contributionCaches[subSyncCommitteeIndex];
      const seenCache = this.seenCaches[subSyncCommitteeIndex];
      const slots = Array.from(contributionCache.keys());
      // object keys are stored in insertion order
      for (const slot of slots.slice(0, slots.length - NUM_SLOTS_IN_CACHE)) {
        contributionCache.delete(slot);
        seenCache.delete(slot);
      }
    }
  }

  private addToContributionCache(
    subCommitteeIndex: phase0.SubCommitteeIndex,
    syncCommitteeSignature: altair.SyncCommitteeSignature,
    indicesInSubSyncCommittee: number[] = []
  ): void {
    const contributionCache = this.contributionCaches[subCommitteeIndex];
    const {slot, beaconBlockRoot} = syncCommitteeSignature;
    // preaggregate
    let slotRootCache = contributionCache.get(slot);
    if (!slotRootCache) {
      slotRootCache = new Map<SlotRootKey, AggregatedSyncCommitteeContribution>();
      contributionCache.set(slot, slotRootCache);
    }
    const key = slotRootKey(syncCommitteeSignature);
    const preContribution = slotRootCache.get(key);
    if (preContribution) {
      const {aggregationBits} = preContribution;
      for (const index of indicesInSubSyncCommittee) {
        aggregationBits[index] = true;
      }
      // accumulate the aggregation, same slot and beaconBlockRoot here
      const newContribution = {
        slot,
        beaconBlockRoot,
        subCommitteeIndex,
        aggregationBits,
        signatures: [...preContribution.signatures, syncCommitteeSignature.signature],
      };
      slotRootCache.set(key, newContribution);
    } else {
      const aggregationBits = Array.from(
        {length: intDiv(this.config.params.SYNC_COMMITTEE_SIZE, altair.SYNC_COMMITTEE_SUBNET_COUNT)},
        (_, i) => indicesInSubSyncCommittee.includes(i)
      );
      // 1st item
      slotRootCache.set(key, {
        slot,
        beaconBlockRoot,
        subCommitteeIndex,
        aggregationBits: aggregationBits as List<boolean>,
        signatures: [syncCommitteeSignature.signature],
      });
    }
  }

  private addToSyncCache(
    subCommitteeIndex: phase0.SubCommitteeIndex,
    syncCommitteeSignature: altair.SyncCommitteeSignature
  ): void {
    const seenCache = this.seenCaches[subCommitteeIndex];
    const {slot, validatorIndex} = syncCommitteeSignature;
    let validatorIndices = seenCache.get(slot);
    if (!validatorIndices) {
      validatorIndices = new Set();
      seenCache.set(slot, validatorIndices);
    }
    validatorIndices?.add(validatorIndex);
  }
}
