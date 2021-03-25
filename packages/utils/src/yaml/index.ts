import {load, dump} from "js-yaml";
import {schema} from "./schema";
import {objectToExpectedCase} from "../objects";

export function loadYaml(yaml: string): Record<string, unknown> {
  return objectToExpectedCase(load(yaml, {schema}));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dumpYaml(yaml: any): string {
  return dump(yaml, {schema});
}
