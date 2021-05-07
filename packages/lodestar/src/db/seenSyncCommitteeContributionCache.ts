import bls, {Signature} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, altair} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {readonlyValues} from "@chainsafe/ssz";
import {NUM_SLOTS_IN_CACHE, slotRootKey, SlotRootKey} from "./repositories/utils/syncCommittee";

type ContriButionsBySlotRoot = Map<SlotRootKey, altair.SyncCommitteeContribution[]>;
/** a seen ContributionAndProof is decided by slot + aggregatorIndex + subCommitteeIndex */
type SeenCacheKey = string;

/**
 * Cache SyncCommitteeContribution and seen ContributionAndProof.
 * This is used for SignedContributionAndProof validation and block factory.
 * This stays in-memory and should be pruned per slot.
 */
export class SeenSyncCommitteeContributionCache {
  private readonly config: IBeaconConfig;
  private contributionsCache: Map<phase0.Slot, ContriButionsBySlotRoot> = new Map<
    phase0.Slot,
    ContriButionsBySlotRoot
  >();
  private seenCache = new Map<phase0.Slot, Set<SeenCacheKey>>();

  constructor(config: IBeaconConfig) {
    this.config = config;
  }
  /**
   * Only call this once we pass all validation.
   */
  addContributionAndProof(contributionAndProof: altair.ContributionAndProof): void {
    // contributionsCache
    const {contribution} = contributionAndProof;
    const {slot} = contribution;
    let contributionsBySlotRoot = this.contributionsCache.get(slot);
    if (!contributionsBySlotRoot) {
      contributionsBySlotRoot = new Map<SlotRootKey, altair.SyncCommitteeContribution[]>();
      this.contributionsCache.set(slot, contributionsBySlotRoot);
    }
    let key = slotRootKey(contribution);
    let contributions = contributionsBySlotRoot.get(key);
    if (!contributions) {
      contributions = [];
      contributionsBySlotRoot.set(key, contributions);
    }
    contributions.push(contribution);
    // seenCache
    let seenContributions = this.seenCache.get(slot);
    if (!seenContributions) {
      seenContributions = new Set<SeenCacheKey>();
      this.seenCache.set(slot, seenContributions);
    }
    key = seenCacheKey(contributionAndProof);
    seenContributions.add(key);
  }

  /**
   * This is for the validation.
   */
  hasContributionAndProof(contributionAndProof: altair.ContributionAndProof): boolean {
    const slot = contributionAndProof.contribution.slot;
    const seenContributions = this.seenCache.get(slot);
    return seenContributions ? seenContributions.has(seenCacheKey(contributionAndProof)) : false;
  }

  /**
   * This is for the block factory, the same to process_sync_committee_contributions in the spec.
   */
  getSyncAggregate(slot: phase0.Slot, beaconBlockRoot: phase0.Root): altair.SyncAggregate {
    const contributions = this.getSyncCommitteeContributions(slot, beaconBlockRoot);
    const syncAggregate = this.config.types.altair.SyncAggregate.defaultValue();
    const signatures: Signature[] = [];
    for (const contribution of contributions) {
      const {subCommitteeIndex, aggregationBits} = contribution;
      const signature = bls.Signature.fromBytes(contribution.signature.valueOf() as Uint8Array);

      const aggBit = Array.from(readonlyValues(aggregationBits));
      for (const [index, participated] of aggBit.entries()) {
        if (participated) {
          const participantIndex =
            intDiv(this.config.params.SYNC_COMMITTEE_SIZE, altair.SYNC_COMMITTEE_SUBNET_COUNT) * subCommitteeIndex +
            index;
          syncAggregate.syncCommitteeBits[participantIndex] = true;
          signatures.push(signature);
        }
      }
    }
    syncAggregate.syncCommitteeSignature = bls.Signature.aggregate(signatures).toBytes();
    return syncAggregate;
  }

  /**
   * Prune per clock slot.
   */
  prune(): void {
    const slots = Array.from(this.contributionsCache.keys());
    // object keys are stored in insertion order
    for (const slot of slots.slice(0, slots.length - NUM_SLOTS_IN_CACHE)) {
      this.contributionsCache.delete(slot);
      this.seenCache.delete(slot);
    }
  }

  getSyncCommitteeContributions(slot: phase0.Slot, beaconBlockRoot: phase0.Root): altair.SyncCommitteeContribution[] {
    const contributionsBySlotRoot = this.contributionsCache.get(slot);
    if (contributionsBySlotRoot) {
      const key = slotRootKey({slot, beaconBlockRoot});
      return contributionsBySlotRoot.get(key) || [];
    }
    return [];
  }
}

function seenCacheKey(contributionAndProof: altair.ContributionAndProof): SeenCacheKey {
  const {aggregatorIndex, contribution} = contributionAndProof;
  const {slot, subCommitteeIndex} = contribution;
  return "" + slot + "_" + aggregatorIndex + "_" + subCommitteeIndex;
}
