import {Epoch, RootHex} from "@chainsafe/lodestar-types";
import {MapDef} from "../../util/map";

/**
 * With this gossip validation condition: [IGNORE] aggregate.data.slot is within the last ATTESTATION_PROPAGATION_SLOT_RANGE slots (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
 * Since ATTESTATION_PROPAGATION_SLOT_RANGE is 32, we keep seen AggregateAndProof in the last 2 epochs.
 */
const MAX_EPOCHS_IN_CACHE = 2;

/**
 * Although there are up to TARGET_AGGREGATORS_PER_COMMITTEE (16 for mainnet) AggregateAndProof messages per slot,
 * they tend to have the same aggregate attestation, but the gossipsub messages-ids are different because they
 * are really different SignedAggregateAndProof object.
 * This is used to address the following spec:
 * _[IGNORE]_ The valid aggregate attestation defined by `hash_tree_root(aggregate)` has _not_ already been seen
 * (via aggregate gossip, within a verified block, or through the creation of an equivalent aggregate locally).
 */
export class SeenAggregatedAttestations {
  /** Roots of aggregated attestation by epoch */
  private readonly aggregateRootsByEpoch = new MapDef<Epoch, Set<RootHex>>(() => new Set<RootHex>());
  private lowestPermissibleEpoch: Epoch = 0;

  isKnown(targetEpoch: Epoch, root: RootHex): boolean {
    return this.aggregateRootsByEpoch.get(targetEpoch)?.has(root) === true;
  }

  add(targetEpoch: Epoch, root: RootHex): void {
    this.aggregateRootsByEpoch.getOrDefault(targetEpoch).add(root);
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
