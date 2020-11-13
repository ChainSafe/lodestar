/* eslint-disable @typescript-eslint/camelcase */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
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
  Epoch,
  ProposerDuty,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Json, toHexString} from "@chainsafe/ssz";
import {HttpClient, urlJoin} from "../../../../util";
import {IValidatorApi} from "../../../interface/validators";

export class RestValidatorApi implements IValidatorApi {
  private readonly client: HttpClient;
  private readonly clientV2: HttpClient;

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.client = new HttpClient({urlPrefix: urlJoin(restUrl, "validator")}, {logger});
    this.clientV2 = new HttpClient({urlPrefix: urlJoin(restUrl, "/eth/v1/validator")}, {logger});
    this.config = config;
  }

  public async getProposerDuties(epoch: Epoch): Promise<ProposerDuty[]> {
    const url = `/duties/proposer/${epoch.toString()}`;
    const responseData = await this.clientV2.get<{data: Json[]}>(url);
    return responseData.data.map((value) => this.config.types.ProposerDuty.fromJson(value, {case: "snake"}));
  }

  public async getAttesterDuties(epoch: Epoch, indices: ValidatorIndex[]): Promise<AttesterDuty[]> {
    const url = `/duties/attester/${epoch.toString()}`;
    const responseData = await this.clientV2.post<string[], {data: Json[]}>(
      url,
      indices.map((index) => this.config.types.ValidatorIndex.toJson(index) as string)
    );
    return responseData.data.map((value) => this.config.types.AttesterDuty.fromJson(value, {case: "snake"}));
  }

  public async publishAggregateAndProof(signedAggregateAndProof: SignedAggregateAndProof): Promise<void> {
    return this.client.post("/aggregate_and_proof", [
      this.config.types.SignedAggregateAndProof.toJson(signedAggregateAndProof, {case: "snake"}),
    ]);
  }

  public async getWireAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]> {
    const url = "/wire_attestations";
    const query = {
      epoch: epoch,
      committee_index: committeeIndex,
    };
    const responseData = await this.client.get<Json[]>(url, query);
    return responseData.map((value) => this.config.types.Attestation.fromJson(value, {case: "snake"}));
  }

  public async produceBlock(
    slot: Slot,
    proposerPubkey: BLSPubkey,
    randaoReveal: Bytes96,
    graffiti: string
  ): Promise<BeaconBlock> {
    const url = "/block";
    const query = {
      slot: slot,
      proposer_pubkey: toHexString(proposerPubkey),
      randao_reveal: toHexString(randaoReveal),
      graffiti: graffiti,
    };
    const responseData = await this.client.get<Json>(url, query);
    return this.config.types.BeaconBlock.fromJson(responseData, {case: "snake"});
  }

  public async produceAttestation(
    validatorPubKey: BLSPubkey,
    committeeIndex: CommitteeIndex,
    slot: Slot
  ): Promise<Attestation> {
    const url = "/attestation";
    const query = {
      slot: slot,
      attestation_committee_index: committeeIndex,
      validator_pubkey: toHexString(validatorPubKey),
    };
    return this.config.types.Attestation.fromJson(await this.client.get<Json>(url, query), {case: "snake"});
  }

  public async produceAggregateAndProof(
    attestationData: AttestationData,
    aggregator: BLSPubkey
  ): Promise<AggregateAndProof> {
    const url = "/aggregate_and_proof";
    const query = {
      aggregator_pubkey: toHexString(aggregator),
      attestation_data: toHexString(this.config.types.AttestationData.serialize(attestationData)),
    };
    return this.config.types.AggregateAndProof.fromJson(await this.client.get<Json>(url, query), {case: "snake"});
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    return this.client.post("/block", this.config.types.SignedBeaconBlock.toJson(signedBlock, {case: "snake"}));
  }

  public async publishAttestation(attestation: Attestation): Promise<void> {
    return this.client.post("/attestation", [this.config.types.Attestation.toJson(attestation, {case: "snake"})]);
  }

  public async subscribeCommitteeSubnet(
    slot: Slot,
    slotSignature: BLSSignature,
    attestationCommitteeIndex: CommitteeIndex,
    aggregatorPubkey: BLSPubkey
  ): Promise<void> {
    return this.client.post(
      "/beacon_committee_subscription",
      this.config.types.SubscribeToCommitteeSubnetPayload.toJson(
        {
          slot,
          slotSignature,
          attestationCommitteeIndex,
          aggregatorPubkey,
        },
        {case: "snake"}
      )
    );
  }
}
