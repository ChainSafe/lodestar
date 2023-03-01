import {Epoch, RootHex} from "@lodestar/types";
import {BitArray} from "@chainsafe/ssz";
import {MapDef} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {isSuperSetOrEqual} from "../../util/bitArray.js";

/**
 * With this gossip validation condition: [IGNORE] aggregate.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
 * Since ATTESTATION_PROPAGATION_SLOT_RANGE is 32, we keep seen AggregateAndProof in the last 2 epochs.
 */
const MAX_EPOCHS_IN_CACHE = 2;

export type AggregationInfo = {
  aggregationBits: BitArray;
  trueBitCount: number;
};

/**
 * Although there are up to TARGET_AGGREGATORS_PER_COMMITTEE (16 for mainnet) AggregateAndProof messages per slot,
 * they tend to have the same aggregate attestation, or one attestation is non-strict superset of another,
 * the gossipsub messages-ids are different because they are really different SignedAggregateAndProof object.
 * This is used to address the following spec in p2p-interface gossipsub:
 * _[IGNORE]_ A valid aggregate attestation defined by `hash_tree_root(aggregate.data)` whose `aggregation_bits` is a
 * non-strict superset has _not_ already been seen.
 *
 * We have AggregatedAttestationPool op pool, however aggregated attestations are not added to that place while this does.
 */
export class SeenAggregatedAttestations {
  /**
   * Array of AttestingIndices by same attestation data root by epoch.
   * Note that there are at most TARGET_AGGREGATORS_PER_COMMITTEE (16) per attestation data.
   * */
  private readonly aggregateRootsByEpoch = new MapDef<Epoch, MapDef<RootHex, AggregationInfo[]>>(
    () => new MapDef<RootHex, AggregationInfo[]>(() => [])
  );
  private lowestPermissibleEpoch: Epoch = 0;

  constructor(private readonly metrics: Metrics | null) {}

  isKnown(targetEpoch: Epoch, attDataRoot: RootHex, aggregationBits: BitArray): boolean {
    const seenAggregationInfoArr = this.aggregateRootsByEpoch.getOrDefault(targetEpoch).getOrDefault(attDataRoot);
    this.metrics?.seenCache.aggregatedAttestations.isKnownCalls.inc();

    for (let i = 0; i < seenAggregationInfoArr.length; i++) {
      if (isSuperSetOrEqual(seenAggregationInfoArr[i].aggregationBits, aggregationBits)) {
        this.metrics?.seenCache.aggregatedAttestations.superSetCheckTotal.observe(i + 1);
        this.metrics?.seenCache.aggregatedAttestations.isKnownHits.inc();
        return true;
      }
    }

    this.metrics?.seenCache.aggregatedAttestations.superSetCheckTotal.observe(seenAggregationInfoArr.length);
    return false;
  }

  add(targetEpoch: Epoch, attDataRoot: RootHex, newItem: AggregationInfo, checkIsKnown: boolean): void {
    const {aggregationBits} = newItem;
    if (checkIsKnown && this.isKnown(targetEpoch, attDataRoot, aggregationBits)) {
      return;
    }

    const seenAggregationInfoArr = this.aggregateRootsByEpoch.getOrDefault(targetEpoch).getOrDefault(attDataRoot);
    insertDesc(seenAggregationInfoArr, newItem);
  }

  prune(currentEpoch: Epoch): void {
    this.lowestPermissibleEpoch = Math.max(currentEpoch - MAX_EPOCHS_IN_CACHE, 0);
    for (const epoch of this.aggregateRootsByEpoch.keys()) {
      if (epoch < this.lowestPermissibleEpoch) {
        this.aggregateRootsByEpoch.delete(epoch);
      }
    }
  }
}

/**
 * Make sure seenAggregationInfoArr is always in desc order based on trueBitCount so that isKnown can be faster
 */
export function insertDesc(seenAggregationInfoArr: AggregationInfo[], newItem: AggregationInfo): void {
  const {trueBitCount} = newItem;
  let found = false;
  for (let i = 0; i < seenAggregationInfoArr.length; i++) {
    if (trueBitCount >= seenAggregationInfoArr[i].trueBitCount) {
      seenAggregationInfoArr.splice(i, 0, newItem);
      found = true;
      break;
    }
  }

  if (!found) seenAggregationInfoArr.push(newItem);
}
