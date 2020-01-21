import fs from "fs";
import {parse, stringify} from "@iarna/toml";
import defaults from "@chainsafe/lodestar/lib/node/options";
import {BeaconNodeOptions} from "../node/options";
import {validateConfig, IConfigurationModule} from "./config";
import {generateTomlConfig} from "./toml";
import {ensureDirectoryExistence} from "@chainsafe/lodestar/lib/util/file";

/**
 * Reads data from file and parses it from toml format to IConfigFile
 * @param {string} fileName path to file to read from
 * @param description
 * @returns configuration object
 */
export function getTomlConfig<T>(fileName: string, description: IConfigurationModule): Partial<T> {
  try {
    const data = fs.readFileSync(fileName);
    return validateConfig<T>(parse(data.toString()), description);
  } catch {
    throw new Error(`${fileName} could not be parsed.`);
  }
}

/**
 * Writes data to file, assuming content is in
 * @param {string} fileName path to file to write to
 * @returns {void}
 */
export function writeTomlConfig(fileName: string): void {
  const content = stringify(generateTomlConfig(defaults, BeaconNodeOptions));
  try {
    ensureDirectoryExistence(fileName);
    fs.writeFileSync(fileName, content);
  } catch {
    throw new Error(`Could not write to ${fileName}`);
  }
}