/* eslint-disable @typescript-eslint/camelcase */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  Attestation,
  AttestationData,
  AttesterDuty,
  BeaconBlock,
  BLSPubkey,
  Bytes96,
  CommitteeIndex,
  Epoch,
  ProposerDuty,
  Root,
  SignedAggregateAndProof,
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

  public async produceBlock(
    slot: Slot,
    proposerPubkey: BLSPubkey,
    randaoReveal: Bytes96,
    graffiti: string
  ): Promise<BeaconBlock> {
    const url = "/block";
    const query = {
      randao_reveal: toHexString(randaoReveal),
      graffiti: graffiti,
    };
    const responseData = await this.clientV2.get<{data: Json}>(url, query);
    return this.config.types.BeaconBlock.fromJson(responseData.data, {case: "snake"});
  }

  public async publishBlock(signedBlock: SignedBeaconBlock): Promise<void> {
    return this.client.post("/block", this.config.types.SignedBeaconBlock.toJson(signedBlock, {case: "snake"}));
  }

  public async produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<AttestationData> {
    const responseData = await this.clientV2.get<{data: Json[]}>("/attestation_data", {committee_index: index, slot});
    return this.config.types.AttestationData.fromJson(responseData.data, {case: "snake"});
  }

  public async getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<Attestation> {
    const responseData = await this.clientV2.get<{data: Json[]}>("/aggregate_attestation", {
      attestation_data_root: this.config.types.Root.toJson(attestationDataRoot) as string,
      slot,
    });
    return this.config.types.Attestation.fromJson(responseData.data, {case: "snake"});
  }

  public async publishAggregateAndProofs(signedAggregateAndProofs: SignedAggregateAndProof[]): Promise<void> {
    return await this.clientV2.post<Json[], void>(
      "/aggregate_and_proofs",
      signedAggregateAndProofs.map((a) => this.config.types.SignedAggregateAndProof.toJson(a, {case: "snake"}))
    );
  }

  public async prepareBeaconCommitteeSubnet(
    validatorIndex: ValidatorIndex,
    committeeIndex: CommitteeIndex,
    committeesAtSlot: number,
    slot: Slot,
    isAggregator: boolean
  ): Promise<void> {
    return await this.clientV2.post<Json[], void>("/beacon_committee_subscriptions", [
      {
        validator_index: validatorIndex,
        committee_index: committeeIndex,
        committees_at_slot: committeesAtSlot,
        slot,
        is_aggregator: isAggregator,
      },
    ]);
  }
}
