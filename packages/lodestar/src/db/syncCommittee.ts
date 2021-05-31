import bls, {PointFormat, Signature} from "@chainsafe/bls";
import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {newFilledArray} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, phase0, Slot} from "@chainsafe/lodestar-types";
import {BitList, toHexString} from "@chainsafe/ssz";

/**
 * SyncCommittee signatures are only useful during a single slot according to our peer's clocks
 */
const MAX_SLOTS_IN_CACHE = 3;

type ContributionFast = Omit<altair.SyncCommitteeContribution, "aggregationBits" | "signature"> & {
  aggregationBits: boolean[];
  signature: Signature;
};

/** ValidataorSubnetKey = `validatorIndex + subCommitteeIndex` */
type ValidataorSubnetKey = string;
/** Hex string of `contribution.beaconBlockRoot` */
type BlockRootHex = string;

/**
 * Preaggregate SyncCommitteeSignature into SyncCommitteeContribution
 * and cache seen SyncCommitteeSignature by slot + validator index.
 * This stays in-memory and should be pruned per slot.
 */
export class SyncCommitteeCache {
  /**
   * Each array item is respective to a subCommitteeIndex.
   * Preaggregate into SyncCommitteeContribution.
   * */
  private readonly contributionsByRootBySubnetBySlot = new Map<
    phase0.Slot,
    Map<number, Map<BlockRootHex, ContributionFast>>
  >();

  /**
   * Each array item is respective to a subCommitteeIndex.
   * A seen SyncCommitteeSignature is decided by slot + validator index.
   */
  private readonly seenCacheBySlot = new Map<phase0.Slot, Set<ValidataorSubnetKey>>();

  constructor(private readonly config: IBeaconConfig) {}

  /** Register item as seen in the cache */
  seen(subnet: phase0.SubCommitteeIndex, syncCommitteeSignature: altair.SyncCommitteeSignature): void {
    const {slot} = syncCommitteeSignature;
    let seenCache = this.seenCacheBySlot.get(slot);
    if (!seenCache) {
      seenCache = new Set<ValidataorSubnetKey>();
      this.seenCacheBySlot.set(slot, seenCache);
    }
    seenCache.add(seenCacheKey(subnet, syncCommitteeSignature));
  }

  // TODO: indexInSubCommittee: number should be indicesInSyncCommittee
  add(subnet: phase0.SubCommitteeIndex, signature: altair.SyncCommitteeSignature, indexInSubCommittee: number): void {
    const {slot, beaconBlockRoot} = signature;
    const rootHex = toHexString(beaconBlockRoot);

    // Pre-aggregate the contribution with existing items
    // Level 1 - by slot
    let contributionsByRootBySubnet = this.contributionsByRootBySubnetBySlot.get(slot);
    if (!contributionsByRootBySubnet) {
      contributionsByRootBySubnet = new Map<number, Map<BlockRootHex, ContributionFast>>();
      this.contributionsByRootBySubnetBySlot.set(slot, contributionsByRootBySubnet);
    }
    // Level 2 - by subnet
    let contributionsByRoot = contributionsByRootBySubnet.get(subnet);
    if (!contributionsByRoot) {
      contributionsByRoot = new Map<BlockRootHex, ContributionFast>();
      contributionsByRootBySubnet.set(subnet, contributionsByRoot);
    }
    // Level 3 - by root
    const contribution = contributionsByRoot.get(rootHex);
    if (contribution) {
      // Aggregate mutating
      aggregateSignatureInto(contribution, signature, indexInSubCommittee);
    } else {
      // Create new aggregate
      contributionsByRoot.set(rootHex, signatureToAggregate(this.config, subnet, signature, indexInSubCommittee));
    }

    // Mark this item as seen for has()
    this.seen(subnet, signature);
  }

  /**
   * based on slot + validator index
   */
  has(subnet: phase0.SubCommitteeIndex, syncCommittee: altair.SyncCommitteeSignature): boolean {
    return this.seenCacheBySlot.get(syncCommittee.slot)?.has(seenCacheKey(subnet, syncCommittee)) === true;
  }

  /**
   * This is for the aggregator to produce ContributionAndProof.
   */
  getSyncCommitteeContribution(
    subnet: phase0.SubCommitteeIndex,
    slot: phase0.Slot,
    prevBlockRoot: phase0.Root
  ): altair.SyncCommitteeContribution | null {
    const contribution = this.contributionsByRootBySubnetBySlot.get(slot)?.get(subnet)?.get(toHexString(prevBlockRoot));
    if (contribution) {
      return {
        ...contribution,
        aggregationBits: contribution.aggregationBits as BitList,
        signature: contribution.signature.toBytes(PointFormat.compressed),
      };
    } else {
      return null;
    }
  }

  /**
   * Prune per clock slot.
   * SyncCommittee signatures are only useful during a single slot according to our peer's clocks
   */
  prune(clockSlot: Slot): void {
    for (const slot of this.contributionsByRootBySubnetBySlot.keys()) {
      if (slot < clockSlot - MAX_SLOTS_IN_CACHE) {
        this.contributionsByRootBySubnetBySlot.delete(slot);
      }
    }

    for (const slot of this.seenCacheBySlot.keys()) {
      if (slot < clockSlot - MAX_SLOTS_IN_CACHE) {
        this.seenCacheBySlot.delete(slot);
      }
    }
  }
}

/**
 * Aggregate a new signature into `contribution` mutating it
 */
function aggregateSignatureInto(
  contribution: ContributionFast,
  signature: altair.SyncCommitteeSignature,
  indexInSubCommittee: number
): void {
  if (contribution.aggregationBits[indexInSubCommittee] === true) {
    throw Error(
      `Already aggregated SyncCommitteeSignature - subCommitteeIndex=${contribution.subCommitteeIndex} indexInSubCommittee=${indexInSubCommittee}`
    );
  }

  contribution.aggregationBits[indexInSubCommittee] = true;

  contribution.signature = Signature.aggregate([
    contribution.signature,
    bls.Signature.fromBytes(signature.signature.valueOf() as Uint8Array),
  ]);
}

/**
 * Format `signature` into an efficient `contribution` to add more signatures in with aggregateSignatureInto()
 */
function signatureToAggregate(
  config: IBeaconConfig,
  subnet: number,
  signature: altair.SyncCommitteeSignature,
  indexInSubCommittee: number
): ContributionFast {
  const indexesPerSubnet = Math.floor(config.params.SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);
  const aggregationBits = newFilledArray(indexesPerSubnet, false);
  aggregationBits[indexInSubCommittee] = true;

  return {
    slot: signature.slot,
    beaconBlockRoot: signature.beaconBlockRoot,
    subCommitteeIndex: subnet,
    aggregationBits,
    signature: bls.Signature.fromBytes(signature.signature.valueOf() as Uint8Array),
  };
}

function seenCacheKey(subnet: number, syncCommittee: altair.SyncCommitteeSignature): ValidataorSubnetKey {
  return `${subnet}-${syncCommittee.validatorIndex}`;
}
