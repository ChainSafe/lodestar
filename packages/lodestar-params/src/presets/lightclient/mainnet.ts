import {lightClientMainnetYaml} from "./mainnetYaml";
import {mapValuesNumToString} from "../../utils";
import {LightClientParams, LightClientParamsSSZ} from "./types";
import {createIBeaconParams} from "../..";

export const lightClientCommit = "060619deffccd38ec82921e186967d9464b7d5c8";
export const lightClientyaml = mapValuesNumToString(lightClientMainnetYaml);
export const lightClientParams = createIBeaconParams(lightClientyaml, LightClientParamsSSZ) as LightClientParams;
