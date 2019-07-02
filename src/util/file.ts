/**
 * @module util/file
 */

import {parse, JsonMap, stringify} from "@iarna/toml";
import {CliError} from "../cli/error";
import fs from "fs";
import path from "path";
import defaults, {BeaconNodeOptions} from "../node/options";
import {generateTomlConfig} from "./toml";

export interface IConfigFile extends JsonMap{
  db?: {name: string};
  chain?: {chain: string};
  rpc?: {port: number};
  eth1?: {depositContract?: {address?: string}};
}

/**
 * Reads data from file and parses it from toml format to IConfigFile
 * @param {string} fileName path to file to read from
 * @returns {IConfigFile}
 */
export function getTomlConfig(fileName: string): IConfigFile {
  let configObject: IConfigFile;
  try {
    const data = fs.readFileSync(fileName);
    configObject = parse(data.toString());
  } catch {
    throw new CliError(`${fileName} could not be parsed.`);
  }
  return configObject;
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
