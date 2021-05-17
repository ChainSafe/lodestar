import {ForkName, IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, altair, BLSPubkey, phase0, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ContainerType, Json, toHexString} from "@chainsafe/ssz";
import {HttpClient, IValidatorFilters} from "../../util";
import {BlockId, IApiClient} from "../interface";

// eslint-disable-next-line @typescript-eslint/naming-convention
export function BeaconApi(config: IBeaconConfig, client: HttpClient): IApiClient["beacon"] {
  return {
    async getGenesis(): Promise<phase0.Genesis> {
      const res = await client.get<{data: Json}>("/eth/v1/beacon/genesis");
      return config.types.phase0.Genesis.fromJson(res.data, {case: "snake"});
    },

    state: {
      async getFork(stateId: "head"): Promise<phase0.Fork> {
        const res = await client.get<{data: Json}>(`/eth/v1/beacon/states/${stateId}/fork`);
        return config.types.phase0.Fork.fromJson(res.data, {case: "snake"});
      },

      async getStateValidators(stateId: "head", filters?: IValidatorFilters): Promise<phase0.ValidatorResponse[]> {
        const query = {
          indices: (filters?.indices || []).map(formatIndex),
          ...(filters?.statuses && {statuses: filters.statuses as string[]}),
        };

        const res = await client.get<{data: Json[]}>(`/eth/v1/beacon/states/${stateId}/validators`, query);
        return res.data.map((value) => config.types.phase0.ValidatorResponse.fromJson(value, {case: "snake"}));
      },
    },

    blocks: {
      async publishBlock(block: allForks.SignedBeaconBlock): Promise<void> {
        await client.post("/eth/v1/beacon/blocks", getSignedBlockType(config, block).toJson(block, {case: "snake"}));
      },

      async getBlockRoot(blockId: BlockId): Promise<Root> {
        const res = await client.get<{data: Json}>(`/eth/v1/beacon/blocks/${blockId}/root`);
        return config.types.phase0.Root.fromJson(res.data, {case: "snake"});
      },
    },

    pool: {
      async submitAttestations(attestations: phase0.Attestation[]): Promise<void> {
        return client.post(
          "/eth/v1/beacon/pool/attestations",
          attestations.map((attestation) => config.types.phase0.Attestation.toJson(attestation, {case: "snake"}))
        );
      },

      async submitVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
        await client.post(
          "/eth/v1/beacon/pool/voluntary_exits",
          config.types.phase0.SignedVoluntaryExit.toJson(signedVoluntaryExit, {case: "snake"})
        );
      },

      async submitSyncCommitteeSignatures(signatures: altair.SyncCommitteeSignature[]): Promise<void> {
        await client.post(
          "/eth/v1/beacon/pool/sync_committees",
          signatures.map((item) => config.types.altair.SyncCommitteeSignature.toJson(item, {case: "snake"}))
        );
      },
    },
  };
}

function formatIndex(validatorId: ValidatorIndex | BLSPubkey): string {
  if (typeof validatorId === "number") {
    return validatorId.toString();
  } else if (typeof validatorId === "string") {
    return validatorId;
  } else {
    return toHexString(validatorId);
  }
}

// TODO: Consider de-duplicating this code that also exists in `packages/lodestar/src/util/multifork.ts`

type SignedBlockType = ContainerType<allForks.SignedBeaconBlock>;

function getSignedBlockType(config: IBeaconConfig, block: allForks.SignedBeaconBlock): SignedBlockType {
  return getSignedBlockTypeFromSlot(config, block.message.slot);
}

function getSignedBlockTypeFromSlot(config: IBeaconConfig, slot: Slot): SignedBlockType {
  switch (config.getForkName(slot)) {
    case ForkName.phase0:
      return (config.types.phase0.SignedBeaconBlock as unknown) as SignedBlockType;
    case ForkName.altair:
      return (config.types.altair.SignedBeaconBlock as unknown) as SignedBlockType;
  }
}
