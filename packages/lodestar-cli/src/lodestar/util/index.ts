import * as fs from "fs";
import * as path from "path";

import PeerId from "peer-id";
import {Json} from "@chainsafe/ssz";
import {ENR, createKeypairFromPeerId} from "@chainsafe/discv5";
import defaults from "@chainsafe/lodestar/lib/node/options";
import {BeaconNodeOptions} from "../../lodestar/node/options";
import {generateTomlConfig} from "../../lodestar/util/toml";

/**
 * Maybe create a directory
 */
export async function mkdir(filename: string): Promise<void> {
  try {
    await fs.promises.readdir(filename);
  } catch (e) {
    await fs.promises.mkdir(filename);
  }
}

export enum FileFormat {
  json = "json",
  yaml = "yaml",
  toml = "toml",
}

/**
 * Write a JSON serializable object to a file
 *
 * Serialize either to json, yaml, or toml
 */
export async function writeFile(filename: string, obj: Json, fileFormat = FileFormat.json): Promise<void> {
  let contents: string;
  switch (fileFormat) {
    case FileFormat.json:
      contents = JSON.stringify(obj, null, 2);
      break;
    default:
      throw new Error("Invalid filetype");
  }
  await fs.promises.writeFile(`${filename}.${fileFormat}`, contents, "utf-8");
}


/**
 * Read a JSON serializable object from a file
 *
 * Parse either from json, yaml, or toml
 */
export async function readFile<T=Json>(filename: string, fileFormat = FileFormat.json): Promise<T> {
  const contents = await fs.promises.readFile(`${filename}.${fileFormat}`, "utf-8");
  switch (fileFormat) {
    case FileFormat.json:
      return JSON.parse(contents);
    default:
      throw new Error("Invalid filetype");
  }
}
