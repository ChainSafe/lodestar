import {Attestation, CommitteeIndex, Epoch, Slot, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

/**
 * Attestation indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AttestationRepository extends Repository<Uint8Array, Attestation> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.attestation, config.types.Attestation);
  }

  public async getCommiteeAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]> {
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

  public async getAttestationsByDataRoot(slot: Slot, attestationDataRoot: Root): Promise<Attestation[]> {
    const attestations = await this.values();
    //TODO: add secondary index slot => root => AttestationData
    return attestations.filter((attestation) => {
      return this.config.types.Root.equals(
        attestationDataRoot,
        this.config.types.AttestationData.hashTreeRoot(attestation.data)
      );
    });
  }

  public async geAttestationsByTargetEpoch(epoch: Epoch): Promise<Attestation[]> {
    const attestations = (await this.values()) || [];
    return attestations.filter((attestation) => attestation.data.target.epoch === epoch);
  }

  public async pruneFinalized(finalizedEpoch: Epoch): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, finalizedEpoch);
    const attestations: Attestation[] = await this.values();
    await this.batchRemove(
      attestations.filter((a) => {
        return a.data.slot < finalizedEpochStartSlot;
      })
    );
  }
}
