import {fetch} from "cross-fetch";
import {Json, TreeBacked} from "@chainsafe/ssz";
import {deserializeProof} from "@chainsafe/persistent-merkle-tree";
import {altair, SyncPeriod, IBeaconSSZTypes} from "@chainsafe/lodestar-types";

type Paths = (string | number)[];

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type, @typescript-eslint/naming-convention
export function LightclientApiClient(beaconApiUrl: string, types: IBeaconSSZTypes) {
  const prefix = "/eth/v1/lightclient";

  async function get<T>(url: string): Promise<T> {
    const res = await fetch(beaconApiUrl + prefix + url, {method: "GET"});
    return (await res.json()) as T;
  }

  return {
    /**
     * GET /eth/v1/lightclient/best_updates/:periods
     */
    async getBestUpdates(from: SyncPeriod, to: SyncPeriod): Promise<altair.LightClientUpdate[]> {
      const res = await get<Json[]>(`/best_updates?from=${from}&to=${to}`);
      return res.map((item) => types.altair.LightClientUpdate.fromJson(item, {case: "snake"}));
    },

    /**
     * GET /eth/v1/lightclient/latest_update_finalized/
     */
    async getLatestUpdateFinalized(): Promise<altair.LightClientUpdate | null> {
      const res = await get<Json>("/latest_update_finalized/");
      return types.altair.LightClientUpdate.fromJson(res, {case: "snake"});
    },

    /**
     * GET /eth/v1/lightclient/latest_update_nonfinalized/
     */
    async getLatestUpdateNonFinalized(): Promise<altair.LightClientUpdate | null> {
      const res = await get<Json>("/latest_update_finalized/");
      return types.altair.LightClientUpdate.fromJson(res, {case: "snake"});
    },

    /**
     * POST /eth/v1/lodestar/proof/:stateId
     */
    async getStateProof(stateId: string, paths: Paths): Promise<TreeBacked<altair.BeaconState>> {
      const res = await fetch(beaconApiUrl + prefix + `/eth/v1/lodestar/proof/${stateId}`, {
        method: "POST",
        body: JSON.stringify({paths}),
      });
      const buffer = await res.arrayBuffer();

      const proof = deserializeProof(buffer as Uint8Array);
      return types.altair.BeaconState.createTreeBackedFromProofUnsafe(proof);
    },
  };
}
