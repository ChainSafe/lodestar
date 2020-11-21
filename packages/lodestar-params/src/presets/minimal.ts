import {minimalYaml} from "./minimalYaml";
import {createIBeaconParams, mapValuesNumToString} from "../utils";
import {IBeaconParams} from "../interface";

export const commit = "v1.0.0";
export const yaml = mapValuesNumToString(minimalYaml);
export const params = createIBeaconParams(yaml) as IBeaconParams;
