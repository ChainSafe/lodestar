import {mainnetJson} from "./mainnetJson";
import {createIBeaconParams} from "../utils";
import {IBeaconParams} from "../interface";

export const commit = "v1.0.0";
export const params = createIBeaconParams(mainnetJson) as IBeaconParams;
