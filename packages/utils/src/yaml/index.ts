import {load, dump} from "js-yaml";
import {schema} from "./schema";
import {objectToExpectedCase} from "../objects";

export function loadYaml(yaml: string): Record<string, unknown> {
  return objectToExpectedCase<Record<string, unknown>>(load(yaml, {schema}));
}

export function dumpYaml(yaml: unknown): string {
  return dump(yaml, {schema});
}
