import {fetch} from "cross-fetch";
import {Json} from "@chainsafe/ssz";
import {deserializeProof, TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {altair, SyncPeriod, IBeaconSSZTypes} from "@chainsafe/lodestar-types";

export type Paths = (string | number)[];

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type, @typescript-eslint/naming-convention
export function LightclientApiClient(beaconApiUrl: string, types: IBeaconSSZTypes) {
  const prefix = "/eth/v1/lightclient";

  async function get<T>(url: string): Promise<T> {
    const res = await fetch(beaconApiUrl + prefix + url, {method: "GET"});
    const body = (await res.json()) as T;

    if (!res.ok) {
      const errorBody = (body as unknown) as {message: string};
      if (typeof errorBody === "object" && errorBody.message) {
        throw Error(errorBody.message);
      } else {
        throw Error(res.statusText);
      }
    }

    return body;
  }

  return {
    /**
     * GET /eth/v1/lightclient/best_updates/:periods
     */
    async getBestUpdates(from: SyncPeriod, to: SyncPeriod): Promise<altair.LightClientUpdate[]> {
      const res = await get<{data: Json[]}>(`/best_updates/${from}..${to}`);
      return res.data.map((item) => types.altair.LightClientUpdate.fromJson(item, {case: "snake"}));
    },

    /**
     * GET /eth/v1/lightclient/latest_update_finalized/
     */
    async getLatestUpdateFinalized(): Promise<altair.LightClientUpdate | null> {
      const res = await get<{data: Json}>("/latest_update_finalized/");
      return types.altair.LightClientUpdate.fromJson(res.data, {case: "snake"});
    },

    /**
     * GET /eth/v1/lightclient/latest_update_nonfinalized/
     */
    async getLatestUpdateNonFinalized(): Promise<altair.LightClientUpdate | null> {
      const res = await get<{data: Json}>("/latest_update_finalized/");
      return types.altair.LightClientUpdate.fromJson(res.data, {case: "snake"});
    },

    /**
     * POST /eth/v1/lodestar/proof/:stateId
     */
    async getStateProof(stateId: string | number, paths: Paths): Promise<TreeOffsetProof> {
      const res = await fetch(beaconApiUrl + prefix + `/eth/v1/lodestar/proof/${stateId}`, {
        method: "POST",
        body: JSON.stringify({paths}),
      });
      const buffer = await res.arrayBuffer();

      return deserializeProof(buffer as Uint8Array) as TreeOffsetProof;
    },
  };
}
