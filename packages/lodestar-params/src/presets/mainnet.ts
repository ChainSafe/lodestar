import {load} from "js-yaml";
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import mainnetYaml from "./mainnet.yaml";
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import phase1MainnetYaml from "../phase1/presets/mainnet.yaml";
import {createParams, schema} from "../utils";
import {IBeaconParams} from "../interface";
import {IPhase1Params, Phase1Params} from "../phase1";
import {BeaconParams} from "..";

export const params: IBeaconParams = {
  ...createParams<IBeaconParams>(load(mainnetYaml, {schema}), BeaconParams),
  phase1: createParams<IPhase1Params>(load(phase1MainnetYaml, {schema}), Phase1Params),
};
