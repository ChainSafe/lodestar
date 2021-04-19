import {IBeaconSSZTypes, phase0} from "@chainsafe/lodestar-types";
import {Json} from "@chainsafe/ssz";
import {HttpClient} from "../../util";
import {IApiClient} from "../interface";

// eslint-disable-next-line @typescript-eslint/naming-convention
export function ConfigApi(types: IBeaconSSZTypes, client: HttpClient): IApiClient["config"] {
  const prefix = "/eth/v1/config";

  return {
    async getForkSchedule(): Promise<phase0.Fork[]> {
      const res = await client.get<{data: Json[]}>(prefix + "/fork_schedule");
      return res.data.map((fork) => types.phase0.Fork.fromJson(fork));
    },
  };
}
