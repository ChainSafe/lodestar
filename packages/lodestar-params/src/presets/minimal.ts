import {BeaconParams} from "..";
import {IBeaconParams} from "../interface";
import {IPhase1Params, Phase1Params} from "../phase1";
import {createParams, mapValuesNumToString} from "../utils";
import {minimalYaml} from "./minimalYaml";
import {minimalYaml as phase1MinimalYaml} from "../phase1/presets/minimalYaml";
import {lightclientParams} from "./lightclient/minimal";
export const commit = "v1.0.0";
export const phase0Yaml = mapValuesNumToString(minimalYaml);
export const phase1Yaml = mapValuesNumToString(phase1MinimalYaml);

const phase0Params = createParams<IBeaconParams>(phase0Yaml, BeaconParams);

export const params: IBeaconParams = {
  ...phase0Params,
  phase1: createParams<IPhase1Params>(phase1Yaml, Phase1Params),
  lightclient: lightclientParams,
};
