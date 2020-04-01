// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import minimalYaml from "./minimal.yaml";
import {convertTypes, schema} from "../utils";
import {typeMap} from "../types";
import {load} from "js-yaml";


// TODO: fix this
const params2 = convertTypes(load(minimalYaml, {schema}), typeMap);
params2.GENESIS_FORK_VERSION[3] = 1;
export const params = params2;
