// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import minimalYaml from "./minimal.yaml";
import {convertTypes, schema} from "../utils";
import {typeMap} from "../types";
import {load} from "js-yaml";


export const params = convertTypes(load(minimalYaml, {schema}), typeMap);