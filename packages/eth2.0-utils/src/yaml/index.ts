import {load} from "js-yaml";
import {readFileSync} from "fs";
import {schema} from "./schema";
// eslint-disable-next-line import/default
import camelcaseKeys from "camelcase-keys";

export function loadYamlFile(path: string): object {
  return camelcaseKeys(
    load(
      readFileSync(path, "utf8"),
      {schema}
    ), {deep: true}
  );
}