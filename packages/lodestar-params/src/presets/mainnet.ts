import {mainnetYaml} from "./mainnetYaml";
import {createIBeaconParams, mapValuesNumToString} from "../utils";
import {IBeaconParams} from "../interface";

export const yaml = mapValuesNumToString(mainnetYaml);
export const params = createIBeaconParams(yaml) as IBeaconParams;
