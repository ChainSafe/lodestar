/* eslint-disable @typescript-eslint/naming-convention */
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CommitteeIndex, Epoch, Root, phase0, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Json, toHexString} from "@chainsafe/ssz";
import {HttpClient, urlJoin} from "../../../../util";
import {BeaconCommitteeSubscription, IValidatorApi} from "../../../interface/validators";

/**
 * Rest API class for fetching and performing validator duties
 */
export class RestValidatorApi implements IValidatorApi {
  private readonly clientV2: HttpClient;

  private readonly config: IBeaconConfig;

  constructor(config: IBeaconConfig, restUrl: string, logger: ILogger) {
    this.clientV2 = new HttpClient({urlPrefix: urlJoin(restUrl, "/eth/v1/validator")}, {logger});
    this.config = config;
  }

  async getProposerDuties(epoch: Epoch): Promise<phase0.ProposerDuty[]> {
    const url = `/duties/proposer/${epoch.toString()}`;
    const responseData = await this.clientV2.get<{data: Json[]}>(url);
    return responseData.data.map((value) => this.config.types.phase0.ProposerDuty.fromJson(value, {case: "snake"}));
  }

  async getAttesterDuties(epoch: Epoch, indices: ValidatorIndex[]): Promise<phase0.AttesterDuty[]> {
    const url = `/duties/attester/${epoch.toString()}`;
    const responseData = await this.clientV2.post<string[], {data: Json[]}>(
      url,
      indices.map((index) => this.config.types.ValidatorIndex.toJson(index) as string)
    );
    return responseData.data.map((value) => this.config.types.phase0.AttesterDuty.fromJson(value, {case: "snake"}));
  }

  async produceBlock(slot: Slot, randaoReveal: Uint8Array, graffiti: string): Promise<phase0.BeaconBlock> {
    const query = {
      randao_reveal: toHexString(randaoReveal),
      graffiti: graffiti,
    };
    const responseData = await this.clientV2.get<{data: Json}>(`/blocks/${slot}`, query);
    return this.config.types.phase0.BeaconBlock.fromJson(responseData.data, {case: "snake"});
  }

  async produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData> {
    const responseData = await this.clientV2.get<{data: Json[]}>("/attestation_data", {committee_index: index, slot});
    return this.config.types.phase0.AttestationData.fromJson(responseData.data, {case: "snake"});
  }

  async getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation> {
    const responseData = await this.clientV2.get<{data: Json[]}>("/aggregate_attestation", {
      attestation_data_root: this.config.types.Root.toJson(attestationDataRoot) as string,
      slot,
    });
    return this.config.types.phase0.Attestation.fromJson(responseData.data, {case: "snake"});
  }

  async publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void> {
    return await this.clientV2.post<Json[], void>(
      "/aggregate_and_proofs",
      signedAggregateAndProofs.map((a) => this.config.types.phase0.SignedAggregateAndProof.toJson(a, {case: "snake"}))
    );
  }

  async prepareBeaconCommitteeSubnet(subscriptions: BeaconCommitteeSubscription[]): Promise<void> {
    return await this.clientV2.post<Json[], void>("/beacon_committee_subscriptions", subscriptions);
  }
}
