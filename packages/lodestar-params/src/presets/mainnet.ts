import {load} from "js-yaml";
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import mainnetYaml from "./mainnet.yaml";
import {createIBeaconParams, schema} from "../utils";
import {IBeaconParams} from "../interface";

export const params = createIBeaconParams(load(mainnetYaml, {schema})) as IBeaconParams;
