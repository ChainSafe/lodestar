import {mainnetYaml} from "./mainnetYaml";
import {mainnetYaml as phase1MainnetYaml} from "../phase1/presets/mainnetYaml";
import {mapValuesNumToString, createParams} from "../utils";
import {IBeaconParams} from "../interface";
import {IPhase1Params, Phase1Params} from "../phase1";
import {BeaconParams} from "..";

export const commit = "v1.0.0";
export const phase0Yaml = mapValuesNumToString(mainnetYaml);
export const phase1Yaml = mapValuesNumToString(phase1MainnetYaml);

export const params: IBeaconParams = {
  ...createParams<IBeaconParams>(phase0Yaml, BeaconParams),
  phase1: createParams<IPhase1Params>(phase1Yaml, Phase1Params),
};
