import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {altair, phase0} from "@chainsafe/lodestar-types";
import {notNullish} from "@chainsafe/lodestar-utils";

/**
 * Repository for SyncCommitteeSignature.
 * Added via gossip or api.
 * Removed when it's old.
 */
export class SyncCommitteeSignatureRepository extends Repository<Uint8Array, altair.SyncCommitteeSignature> {
  // index to produce SyncCommitteeContribution
  // for each slot, index SyncCommitteeSignature roots by block root hex
  private contributionIndex = new Map<phase0.Slot, Map<string, string[]>>();
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.altair_syncCommitteeSignature, config.types.altair.SyncCommitteeSignature);
  }

  async put(key: Uint8Array, value: altair.SyncCommitteeSignature): Promise<void> {
    const blockRootHex = toHexString(value.beaconBlockRoot);
    const slot = value.slot;
    const rootHex = toHexString(key);
    let slotIndex = this.contributionIndex.get(slot);
    if (!slotIndex) {
      slotIndex = new Map();
      this.contributionIndex.set(slot, slotIndex);
    }
    if (!slotIndex.get(blockRootHex)) {
      slotIndex.set(blockRootHex, [rootHex]);
    } else {
      const rootHexes = new Set([rootHex, ...(slotIndex.get(blockRootHex) || [])]);
      slotIndex.set(blockRootHex, Array.from(rootHexes));
    }
    await super.put(key, value);
  }

  async getByBlock(slot: phase0.Slot, blockRootHex: phase0.Root): Promise<altair.SyncCommitteeSignature[]> {
    const rootsByBlockRoot = this.contributionIndex.get(slot);
    if (!rootsByBlockRoot) return [];
    const rootHexes = rootsByBlockRoot.get(toHexString(blockRootHex));
    if (!rootHexes) return [];
    const syncCommitteeSignatures = await Promise.all(rootHexes.map((rootHex) => this.get(fromHexString(rootHex))));
    return syncCommitteeSignatures.filter(notNullish);
  }

  async pruneFinalized(finalizedEpoch: phase0.Epoch): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, finalizedEpoch);
    const entries = await this.entries();
    const idsToDelete = entries.filter((e) => e.value.slot < finalizedEpochStartSlot).map((e) => e.key);
    await this.batchDelete(idsToDelete);
    for (const slot of this.contributionIndex.keys()) {
      if (slot < finalizedEpochStartSlot) this.contributionIndex.delete(slot);
    }
  }
}
