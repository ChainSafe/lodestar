import {phase0, CommitteeIndex, Epoch, Slot, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {notNullish} from "@chainsafe/lodestar-utils";

/**
 * Attestation indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AttestationRepository extends Repository<Uint8Array, phase0.Attestation> {
  // For each slot, index attestation roots by attestation data root hex
  // do batch remove per finalized checkpoint
  private dataRootIndex = new Map<Slot, Map<string, string[]>>();

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0_attestation, config.types.phase0.Attestation);
  }

  async put(key: Uint8Array, value: phase0.Attestation): Promise<void> {
    const attestationDataRoot = this.config.types.phase0.AttestationData.hashTreeRoot(value.data);
    const slot = value.data.slot;
    const dataRootHex = toHexString(attestationDataRoot);
    const rootHex = toHexString(key);
    let slotIndex = this.dataRootIndex.get(slot);
    if (!slotIndex) {
      slotIndex = new Map();
      this.dataRootIndex.set(slot, slotIndex);
    }
    if (!slotIndex.get(dataRootHex)) {
      slotIndex.set(dataRootHex, [rootHex]);
    } else {
      const rootHexes = new Set([rootHex, ...(slotIndex.get(dataRootHex) || [])]);
      slotIndex.set(dataRootHex, Array.from(rootHexes));
    }
    await super.put(key, value);
  }

  async getCommiteeAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<phase0.Attestation[]> {
    const attestations = await this.values();
    return attestations.filter((attestation) => {
      return (
        attestation.data.index === committeeIndex &&
        computeEpochAtSlot(this.config, attestation.data.slot) === epoch &&
        // filter out aggregated attestations
        Array.from(attestation.aggregationBits).filter((bit) => !!bit).length === 1
      );
    });
  }

  async getAttestationsByDataRoot(slot: Slot, attestationDataRoot: Root): Promise<phase0.Attestation[]> {
    const dataRootsAtSlot = this.dataRootIndex.get(slot);
    if (!dataRootsAtSlot) return [];
    const rootHexes = dataRootsAtSlot.get(toHexString(attestationDataRoot));
    if (!rootHexes) return [];
    const attestations = await Promise.all(rootHexes.map((rootHex) => this.get(fromHexString(rootHex))));
    return attestations.filter(notNullish);
  }

  async geAttestationsByTargetEpoch(epoch: Epoch): Promise<phase0.Attestation[]> {
    const attestations = (await this.values()) || [];
    return attestations.filter((attestation) => attestation.data.target.epoch === epoch);
  }

  async pruneFinalized(finalizedEpoch: Epoch): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, finalizedEpoch);
    const attestations: phase0.Attestation[] = await this.values();
    await this.batchRemove(
      attestations.filter((a) => {
        return a.data.slot < finalizedEpochStartSlot;
      })
    );
    for (const slot of this.dataRootIndex.keys()) {
      if (slot < finalizedEpochStartSlot) this.dataRootIndex.delete(slot);
    }
  }
}
