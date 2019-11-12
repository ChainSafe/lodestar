import {readFileSync} from "fs";

import {loadYaml} from "../yaml";

export function loadYamlFile(path: string): object {
  return loadYaml(readFileSync(path, "utf8"));
}
