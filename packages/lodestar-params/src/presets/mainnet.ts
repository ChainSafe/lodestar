import {BeaconParams} from "..";
import {IBeaconParams} from "../interface";
import {IPhase1Params, Phase1Params} from "../phase1";
import {mainnetYaml as phase1MainnetYaml} from "../phase1/presets/mainnetYaml";
import {createParams, mapValuesNumToString} from "../utils";
import {lightclientParams} from "./lightclient/mainnet";
import {mainnetYaml} from "./mainnetYaml";

export const commit = "v1.0.0";
export const phase0Yaml = mapValuesNumToString(mainnetYaml);
export const phase1Yaml = mapValuesNumToString(phase1MainnetYaml);

const phase0Params = createParams<IBeaconParams>(phase0Yaml, BeaconParams);

export const params: IBeaconParams = {
  ...phase0Params,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ALL_FORKS: [
    {
      epoch: 0,
      currentVersion: 16777216,
      previousVersion: 16777216,
    },
  ],
  phase1: createParams<IPhase1Params>(phase1Yaml, Phase1Params),
  lightclient: lightclientParams,
};
