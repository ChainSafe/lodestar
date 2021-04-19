import {CommitteeIndex, Epoch, Root, phase0, Slot, ValidatorIndex, IBeaconSSZTypes} from "@chainsafe/lodestar-types";
import {Json, toHexString} from "@chainsafe/ssz";
import {HttpClient} from "../../util";
import {IApiClient} from "../interface";

/* eslint-disable @typescript-eslint/naming-convention */

export function ValidatorApi(types: IBeaconSSZTypes, client: HttpClient): IApiClient["validator"] {
  const prefix = "/eth/v1/validator";

  return {
    async getProposerDuties(epoch: Epoch): Promise<phase0.ProposerDutiesApi> {
      const res = await client.get<{data: Json[]; dependentRoot: string}>(
        prefix + `/duties/proposer/${epoch.toString()}`
      );
      return types.phase0.ProposerDutiesApi.fromJson(res, {case: "snake"});
    },

    async getAttesterDuties(epoch: Epoch, indices: ValidatorIndex[]): Promise<phase0.AttesterDutiesApi> {
      const res = await client.post<string[], {data: Json[]; dependentRoot: string}>(
        prefix + `/duties/attester/${epoch.toString()}`,
        indices.map((index) => types.ValidatorIndex.toJson(index) as string)
      );
      return types.phase0.AttesterDutiesApi.fromJson(res, {case: "snake"});
    },

    async produceBlock(slot: Slot, randaoReveal: Uint8Array, graffiti: string): Promise<phase0.BeaconBlock> {
      const res = await client.get<{data: Json}>(prefix + `/blocks/${slot}`, {
        randao_reveal: toHexString(randaoReveal),
        graffiti,
      });
      return types.phase0.BeaconBlock.fromJson(res.data, {case: "snake"});
    },

    async produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData> {
      const res = await client.get<{data: Json[]}>(prefix + "/attestation_data", {committee_index: index, slot});
      return types.phase0.AttestationData.fromJson(res.data, {case: "snake"});
    },

    async getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation> {
      const res = await client.get<{data: Json[]}>(prefix + "/aggregate_attestation", {
        attestation_data_root: types.Root.toJson(attestationDataRoot) as string,
        slot,
      });
      return types.phase0.Attestation.fromJson(res.data, {case: "snake"});
    },

    async publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void> {
      await client.post<Json[], void>(
        prefix + "/aggregate_and_proofs",
        signedAggregateAndProofs.map((a) => types.phase0.SignedAggregateAndProof.toJson(a, {case: "snake"}))
      );
    },

    async prepareBeaconCommitteeSubnet(subscriptions: phase0.BeaconCommitteeSubscription[]): Promise<void> {
      await client.post<Json[], void>(
        prefix + "/beacon_committee_subscriptions",
        subscriptions.map((s) => types.phase0.BeaconCommitteeSubscription.toJson(s, {case: "snake"}))
      );
    },
  };
}
