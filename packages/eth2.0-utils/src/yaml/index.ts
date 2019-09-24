import {load, dump} from "js-yaml";
import {readFileSync} from "fs";
import {schema} from "./schema";
// eslint-disable-next-line import/default
import camelcaseKeys from "camelcase-keys";

export function loadYamlFile(path: string): object {
  return loadYaml(readFileSync(path, "utf8"));
}

export function loadYaml(yaml: string): object {
  return camelcaseKeys(
    load(
      yaml,
      {schema}
    ), {deep: true}
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dumpYaml(yaml: any): string {
  return dump(yaml, {schema});
}