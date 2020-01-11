/**
 * @module util/file
 */

import {parse, stringify} from "@iarna/toml";
import fs from "fs";
import path from "path";
import defaults, {BeaconNodeOptions} from "../node/options";
import {generateTomlConfig} from "./toml";
import {IConfigurationModule, validateConfig} from "./config";

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

/**
 * Recursively ensures directory exists by creating any missing directories
 * @param {string} filePath
 */
export function ensureDirectoryExistence(filePath: string): boolean {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
  return true;
}

export function rmDir(dir: string): void {
  const list = fs.readdirSync(dir);
  for(let i = 0; i < list.length; i++) {
    const filename = path.join(dir, list[i]);
    const stat = fs.statSync(filename);
                
    if(filename == "." || filename == "..") {
      // pass these files
    } else if(stat.isDirectory()) {
      // rmdir recursively
      rmDir(filename);
    } else {
      // rm fiilename
      fs.unlinkSync(filename);
    }
  }
  fs.rmdirSync(dir);
}

