// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import mainnetYaml from "./mainnet.yaml";
import {load} from "js-yaml";
import {convertTypes, schema} from "../utils";
import {typeMap} from "../types";


export const params = convertTypes(load(mainnetYaml, {schema}), typeMap);