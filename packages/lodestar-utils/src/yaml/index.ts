import {load, dump} from "js-yaml";
import {schema} from "./schema";
import {objectToCamelCase} from "../misc";

export function loadYaml(yaml: string): object {
  return objectToCamelCase(
    load(
      yaml,
      {schema}
    )
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dumpYaml(yaml: any): string {
  return dump(yaml, {schema});
}
