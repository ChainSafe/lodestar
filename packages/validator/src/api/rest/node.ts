import {HttpClient} from "../../util";
import {IApiClient} from "../interface";
import {IBeaconSSZTypes, phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";

// eslint-disable-next-line @typescript-eslint/naming-convention
export function NodeApi(types: IBeaconSSZTypes, client: HttpClient): IApiClient["node"] {
  const prefix = "/eth/v1/node";

  return {
    async getVersion(): Promise<string> {
      const res = await client.get<{data: {version: string}}>(prefix + "/version");
      return res.data.version;
    },

    async getSyncingStatus(): Promise<phase0.SyncingStatus> {
      const res = await client.get<{data: Json}>(prefix + "/syncing");
      return types.phase0.SyncingStatus.fromJson(res.data, {case: "snake"});
    },
  };
}
