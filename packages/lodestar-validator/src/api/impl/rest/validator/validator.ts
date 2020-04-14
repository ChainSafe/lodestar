import {
  AggregateAndProof,
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  BLSSignature,
  Bytes96,
  CommitteeIndex,
  Epoch, ProposerDuty,
  SignedBeaconBlock,
  Slot
} from "@chainsafe/lodestar-types";
import {IValidatorApi} from "../../../interface/validators";
import {HttpClient} from "../../../../util";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {fromHexString, Json, toHexString} from "@chainsafe/ssz";

export class RestValidatorApi implements IValidatorApi {

  private readonly client: HttpClient;

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: `${restUrl}/validator`}, {logger});
    this.config = config;
  }

  public async getProposerDuties(epoch: Epoch): Promise<ProposerDuty[]> {
    const url = `/duties/${epoch.toString()}/proposer`;
    const responseData = await this.client.get<Json[]>(url);
    return responseData.map(this.config.types.ProposerDuty.fromJson);
  }

  public async getAttesterDuties(epoch: Epoch, validatorPubKeys: BLSPubkey[]): Promise<AttesterDuty[]> {
    const hexPubKeys = validatorPubKeys.map(toHexString);
    const url = `/duties/${epoch.toString()}/attester?validator_pubkeys=${JSON.stringify(hexPubKeys)}`;
    const responseData = await this.client.get<Json[]>(url);
    return responseData.map(value => this.config.types.AttesterDuty.fromJson(value));
  }

  public async publishAggregatedAttestation(
    aggregate: AggregateAndProof,
  ): Promise<void> {
    return this.client.post(
      "/aggregate_and_proof",
      [this.config.types.AggregateAndProof.toJson(aggregate)]
    );
  }

  public async getWireAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]> {
    const url = `/wire_attestations?epoch=${epoch}&committee_index=${committeeIndex}`;
    const responseData = await this.client.get<Json[]>(url);
    return responseData.map(value => this.config.types.Attestation.fromJson(value));
  }

  public async produceBlock(slot: Slot, randaoReveal: Bytes96): Promise<BeaconBlock> {
    const url = `/block?slot=${slot}&randao_reveal=${toHexString(randaoReveal)}`;
    return this.config.types.BeaconBlock.fromJson(await this.client.get<Json>(url));
  }

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    slot: Slot,
    committeeIndex: CommitteeIndex
  ): Promise<Attestation> {
    const url = "/attestation"
        +`?slot=${slot}&committee_index=${committeeIndex}&validator_pubkey=${toHexString(validatorPubKey)}`;
    return this.config.types.Attestation.fromJson(await this.client.get<Json>(url));
  }

  public async produceAggregateAndProof(
    attestationData: AttestationData, aggregator: BLSPubkey
  ): Promise<AggregateAndProof> {
    const url = `/aggregate_and_proof?aggregator_pubkey=${toHexString(aggregator)}`
        +`&attestation_data=${toHexString(this.config.types.AttestationData.serialize(attestationData))}`;
    return this.config.types.AggregateAndProof.fromJson(await this.client.get<Json>(url));
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    return this.client.post("/block", this.config.types.SignedBeaconBlock.toJson(signedBlock));
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/attestation", [this.config.types.Attestation.toJson(attestation)]);
  }
  
  public async subscribeCommitteeSubnet(
    slot: Slot,
    slotSignature: BLSSignature,
    attestationCommitteeIndex: CommitteeIndex,
    aggregatorPubkey: BLSPubkey
  ): Promise<void> {
    return this.client.post(
      "/beacon_committee_subscription",
      this.config.types.SubscribeToCommitteeSubnetPayload.toJson({
        slot,
        slotSignature,
        attestationCommitteeIndex,
        aggregatorPubkey
      })
    );
  }
}
