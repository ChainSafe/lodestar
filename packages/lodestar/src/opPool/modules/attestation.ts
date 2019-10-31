import {Attestation, BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {OperationsModule} from "./abstract";
import {
  aggregateAttestation,
  canBeAggregated,
  computeStartSlotOfEpoch,
  getAttestationDataSlot,
  processAttestation} from "@chainsafe/eth2.0-state-transition";
import {AttestationRepository} from "../../db/api/beacon/repositories";
import {clone, hashTreeRoot} from "@chainsafe/ssz";

import {AttestationDataRepository} from "../../db/api/beacon/repositories/attestationsData";

export class AttestationOperations extends OperationsModule<Attestation> {
  private readonly config: IBeaconConfig;

  private readonly attestationDataDb: AttestationDataRepository;

  public constructor(
    db: AttestationRepository,
    attestationDataDb: AttestationDataRepository,
    {config}: {config: IBeaconConfig}
  ) {
    super(db);
    this.attestationDataDb = attestationDataDb;
    this.config = config;
  }

  public async receive(value: Attestation): Promise<void> {
    const attestationDataHash = hashTreeRoot(value.data, this.config.types.AttestationData);
    const existingAttestationHashes = await this.attestationDataDb.get(
      attestationDataHash
    );
    if(existingAttestationHashes) {
      await Promise.all(existingAttestationHashes.map(async (attestationHash) => {
        const existingAttestation = await this.db.get(attestationHash);
        if(existingAttestation && canBeAggregated(this.config, existingAttestation, value)) {
          const aggregated = aggregateAttestation(this.config, existingAttestation, value);
          const existingAttestationHash = hashTreeRoot(existingAttestation, this.config.types.Attestation);
          await Promise.all([
            this.db.setUnderRoot(aggregated),
            this.db.delete(existingAttestationHash),
            this.attestationDataDb.removeAttestation(attestationDataHash, existingAttestationHash)
          ]);
        }
      }));
    }
    return super.receive(value);
  }

  public async getValid(state: BeaconState): Promise<Attestation[]> {
    const attestations: Attestation[] = await this.getAll();
    state = clone(state, this.config.types.BeaconState);
    return attestations.filter((a: Attestation) => {
      try {
        processAttestation(this.config, state, a);
        return true;
      } catch (e) {
        return false;
      }
    });
  }

  public async removeOld(state: BeaconState): Promise<void> {
    //TODO: figure out how to clean attestatiodData->attestation mapping
    const finalizedEpochStartSlot = computeStartSlotOfEpoch(this.config, state.finalizedCheckpoint.epoch);
    const attestations: Attestation[] = await this.getAll();
    await this.remove(attestations.filter((a) => {
      const aSlot = getAttestationDataSlot(this.config, state, a.data);
      return finalizedEpochStartSlot <= aSlot;
    }));
  }
}
