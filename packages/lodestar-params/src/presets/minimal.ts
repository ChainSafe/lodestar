import {load} from "js-yaml";
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import minimalYaml from "./minimal.yaml";
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import phase1MinimalYaml from "../phase1/presets/minimal.yaml";
import {createParams, schema} from "../utils";
import {IBeaconParams} from "../interface";
import {IPhase1Params} from "../phase1";
import {BeaconParams} from "..";
import {Phase1Params} from "../phase1";

export const params: IBeaconParams = {
  ...createParams<IBeaconParams>(load(minimalYaml, {schema}), BeaconParams),
  phase1: createParams<IPhase1Params>(load(phase1MinimalYaml, {schema}), Phase1Params),
};
