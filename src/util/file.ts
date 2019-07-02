/**
 * @module util/file
 */

import {parse, JsonMap, stringify} from "@iarna/toml";
import {CliError} from "../cli/error";
import fs from "fs";
import path from "path";
import defaults, {BeaconNodeOptions} from "../node/options";
import {generateTomlConfig, validateConfig} from "./toml";
import {IConfigurationModule} from "./config";

/**
 * Reads data from file and parses it from toml format to IConfigFile
 * @param {string} fileName path to file to read from
 * @param description
 * @returns configuration object
 */
export function getTomlConfig(fileName: string, description: IConfigurationModule): any {
  try {
    const data = fs.readFileSync(fileName);
    return validateConfig(parse(data.toString()), description);
  } catch {
    throw new CliError(`${fileName} could not be parsed.`);
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
    throw new CliError(`Could not write to ${fileName}`);
  }
}

/**
 * Recursively ensures directory exists by creating any missing directories
 * @param {string} filePath
 */
export function ensureDirectoryExistence(filePath: string): boolean {
  var dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
  return true;
}
