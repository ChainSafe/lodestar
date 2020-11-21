import {minimalYaml} from "./minimal.yaml";
import {createIBeaconParams, mapValuesNumToString} from "../utils";
import {IBeaconParams} from "../interface";

export const yaml = mapValuesNumToString(minimalYaml);
export const params = createIBeaconParams(yaml) as IBeaconParams;
