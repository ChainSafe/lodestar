import {Epoch, RootHex} from "@chainsafe/lodestar-types";
import {isNonStrictSuperSet} from "../../util/array";
import {MapDef} from "../../util/map";

/**
 * With this gossip validation condition: [IGNORE] aggregate.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
 * Since ATTESTATION_PROPAGATION_SLOT_RANGE is 32, we keep seen AggregateAndProof in the last 2 epochs.
 */
const MAX_EPOCHS_IN_CACHE = 2;

type AttestingIndices = number[];

/**
 * Although there are up to TARGET_AGGREGATORS_PER_COMMITTEE (16 for mainnet) AggregateAndProof messages per slot,
 * they tend to have the same aggregate attestation, or one attestation is non-strict superset of another,
 * the gossipsub messages-ids are different because they are really different SignedAggregateAndProof object.
 * This is used to address the following spec in p2p-interface gossipsub:
 * _[IGNORE]_ A valid aggregate attestation defined by `hash_tree_root(aggregate.data)` whose `aggregation_bits` is a
 * non-strict superset has _not_ already been seen.
 */
export class SeenAggregatedAttestations {
  /**
   * Array of AttestingIndices by same attestation data root by epoch.
   * Note that there are at most TARGET_AGGREGATORS_PER_COMMITTEE (16) per attestation data.
   * */
  private readonly aggregateRootsByEpoch = new MapDef<Epoch, MapDef<RootHex, AttestingIndices[]>>(
    () => new MapDef<RootHex, AttestingIndices[]>(() => [])
  );
  private lowestPermissibleEpoch: Epoch = 0;

  isKnown(targetEpoch: Epoch, attDataRoot: RootHex, attestingIndices: AttestingIndices): boolean {
    const seenAttestingIndicesArr = this.aggregateRootsByEpoch.getOrDefault(targetEpoch).getOrDefault(attDataRoot);
    return seenAttestingIndicesArr.some((seenAttestingIndices) =>
      isNonStrictSuperSet(seenAttestingIndices, attestingIndices)
    );
  }

  add(targetEpoch: Epoch, attDataRoot: RootHex, attestingIndices: AttestingIndices, checkIsKnown: boolean): void {
    if (checkIsKnown && this.isKnown(targetEpoch, attDataRoot, attestingIndices)) {
      return;
    }

    const seenAttestingIndicesArr = this.aggregateRootsByEpoch.getOrDefault(targetEpoch).getOrDefault(attDataRoot);
    seenAttestingIndicesArr.push(attestingIndices);
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
