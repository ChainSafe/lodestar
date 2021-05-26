import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0, altair, CommitteeIndex, Epoch, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {Json, toHexString} from "@chainsafe/ssz";
import {HttpClient} from "../../util";
import {IApiClient} from "../interface";

/* eslint-disable @typescript-eslint/naming-convention */

export function ValidatorApi(config: IBeaconConfig, client: HttpClient): IApiClient["validator"] {
  return {
    async getProposerDuties(epoch: Epoch): Promise<phase0.ProposerDutiesApi> {
      const res = await client.get<{data: Json[]; dependentRoot: string}>(
        `/eth/v1/validator/duties/proposer/${epoch.toString()}`
      );
      return config.types.phase0.ProposerDutiesApi.fromJson(res, {case: "snake"});
    },

    async getAttesterDuties(epoch: Epoch, indices: ValidatorIndex[]): Promise<phase0.AttesterDutiesApi> {
      const res = await client.post<string[], {data: Json[]; dependentRoot: string}>(
        `/eth/v1/validator/duties/attester/${epoch.toString()}`,
        indices.map((index) => config.types.ValidatorIndex.toJson(index) as string)
      );
      return config.types.phase0.AttesterDutiesApi.fromJson(res, {case: "snake"});
    },

    async getSyncCommitteeDuties(epoch: number, indices: ValidatorIndex[]): Promise<altair.SyncDutiesApi> {
      const res = await client.post<string[], {data: Json[]; dependentRoot: string}>(
        `/eth/v1/validator/duties/sync/${epoch.toString()}`,
        indices.map((index) => config.types.ValidatorIndex.toJson(index) as string)
      );
      return config.types.altair.SyncDutiesApi.fromJson(res, {case: "snake"});
    },

    async produceBlock(slot: Slot, randaoReveal: Uint8Array, graffiti: string): Promise<allForks.BeaconBlock> {
      const res = await client.get<{data: Json}>(`/eth/v1/validator/blocks/${slot}`, {
        randao_reveal: toHexString(randaoReveal),
        graffiti,
      });
      return config.getForkTypes(slot).BeaconBlock.fromJson(res.data, {case: "snake"});
    },

    async produceAttestationData(index: CommitteeIndex, slot: Slot): Promise<phase0.AttestationData> {
      const res = await client.get<{data: Json[]}>("/eth/v1/validator/attestation_data", {
        committee_index: index,
        slot,
      });
      return config.types.phase0.AttestationData.fromJson(res.data, {case: "snake"});
    },

    async produceSyncCommitteeContribution(
      slot: Slot,
      subcommitteeIndex: number,
      beaconBlockRoot: Root
    ): Promise<altair.SyncCommitteeContribution> {
      const res = await client.get<{data: Json}>("/eth/v1/validator/sync_committee_contribution", {
        subcommittee_index: subcommitteeIndex,
        slot,
        beacon_block_root: toHexString(beaconBlockRoot),
      });
      return config.types.altair.SyncCommitteeContribution.fromJson(res.data, {case: "snake"});
    },

    async getAggregatedAttestation(attestationDataRoot: Root, slot: Slot): Promise<phase0.Attestation> {
      const res = await client.get<{data: Json[]}>("/eth/v1/validator/aggregate_attestation", {
        attestation_data_root: config.types.Root.toJson(attestationDataRoot) as string,
        slot,
      });
      return config.types.phase0.Attestation.fromJson(res.data, {case: "snake"});
    },

    async publishAggregateAndProofs(signedAggregateAndProofs: phase0.SignedAggregateAndProof[]): Promise<void> {
      await client.post<Json[], void>(
        "/eth/v1/validator/aggregate_and_proofs",
        signedAggregateAndProofs.map((a) => config.types.phase0.SignedAggregateAndProof.toJson(a, {case: "snake"}))
      );
    },

    async publishContributionAndProofs(contributionAndProofs: altair.SignedContributionAndProof[]): Promise<void> {
      await client.post<Json[], void>(
        "/eth/v1/validator/contribution_and_proofs",
        contributionAndProofs.map((item) =>
          config.types.altair.SignedContributionAndProof.toJson(item, {case: "snake"})
        )
      );
    },

    async prepareBeaconCommitteeSubnet(subscriptions: phase0.BeaconCommitteeSubscription[]): Promise<void> {
      await client.post<Json[], void>(
        "/eth/v1/validator/beacon_committee_subscriptions",
        subscriptions.map((s) => config.types.phase0.BeaconCommitteeSubscription.toJson(s, {case: "snake"}))
      );
    },

    async prepareSyncCommitteeSubnets(subscriptions: altair.SyncCommitteeSubscription[]): Promise<void> {
      await client.post<Json[], void>(
        "/eth/v1/validator/sync_committee_subscriptions",
        subscriptions.map((item) => config.types.altair.SyncCommitteeSubscription.toJson(item, {case: "snake"}))
      );
    },
  };
}
