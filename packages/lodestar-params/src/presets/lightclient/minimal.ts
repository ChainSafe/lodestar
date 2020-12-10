import {lightclientMinimalYaml} from "./minimalYaml";
import {mapValuesNumToString} from "../../utils";
import {LightclientParams, LightclientParamsSSZ} from "./types";
import {createIBeaconParams} from "../..";

export const lightclientCommit = "060619deffccd38ec82921e186967d9464b7d5c8";
export const lightclientyaml = mapValuesNumToString(lightclientMinimalYaml);
export const lightclientParams = createIBeaconParams(lightclientyaml, LightclientParamsSSZ) as LightclientParams;
