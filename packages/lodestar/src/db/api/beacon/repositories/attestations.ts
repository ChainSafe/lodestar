import {Attestation} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BulkRepository, Id} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";
import {AttestationDataRepository} from "./attestationsData";
import {hashTreeRoot} from "@chainsafe/ssz";

export class AttestationRepository extends BulkRepository<Attestation> {

  private attestationDataRepository: AttestationDataRepository;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController,
    attestationDataRepository: AttestationDataRepository) {
    super(config, db, Bucket.attestation, config.types.Attestation);
    this.attestationDataRepository = attestationDataRepository;
  }

  public async set(id: Id, value: Attestation): Promise<void> {
    super.set(id, value);
    await this.attestationDataRepository.addAttestation(
      hashTreeRoot(value.data, this.config.types.AttestationData),
      hashTreeRoot(value, this.type)
    );
  }

}
