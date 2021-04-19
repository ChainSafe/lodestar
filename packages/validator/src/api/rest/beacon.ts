import {BLSPubkey, IBeaconSSZTypes, phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {Json, toHexString} from "@chainsafe/ssz";
import {HttpClient, IValidatorFilters} from "../../util";
import {IApiClient} from "../interface";

// eslint-disable-next-line @typescript-eslint/naming-convention
export function BeaconApi(types: IBeaconSSZTypes, client: HttpClient): IApiClient["beacon"] {
  const prefix = "/eth/v1/beacon";

  return {
    async getGenesis(): Promise<phase0.Genesis> {
      const res = await client.get<{data: Json}>(prefix + "/genesis");
      return types.phase0.Genesis.fromJson(res.data, {case: "snake"});
    },

    state: {
      async getFork(stateId: "head"): Promise<phase0.Fork> {
        const res = await client.get<{data: Json}>(prefix + `/states/${stateId}/fork`);
        return types.phase0.Fork.fromJson(res.data, {case: "snake"});
      },

      async getStateValidators(stateId: "head", filters?: IValidatorFilters): Promise<phase0.ValidatorResponse[]> {
        const query = {
          indices: (filters?.indices || []).map(formatIndex),
          ...(filters?.statuses && {statuses: filters.statuses as string[]}),
        };

        const res = await client.get<{data: Json[]}>(prefix + `/states/${stateId}/validators`, query);
        return res.data.map((value) => types.phase0.ValidatorResponse.fromJson(value, {case: "snake"}));
      },
    },

    blocks: {
      async publishBlock(block: phase0.SignedBeaconBlock): Promise<void> {
        await client.post(prefix + "/blocks", types.phase0.SignedBeaconBlock.toJson(block, {case: "snake"}));
      },
    },

    pool: {
      async submitAttestations(attestations: phase0.Attestation[]): Promise<void> {
        return client.post(
          prefix + "/pool/attestations",
          attestations.map((attestation) => types.phase0.Attestation.toJson(attestation, {case: "snake"}))
        );
      },

      async submitVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
        await client.post(
          prefix + "/pool/voluntary_exits",
          types.phase0.SignedVoluntaryExit.toJson(signedVoluntaryExit, {case: "snake"})
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
