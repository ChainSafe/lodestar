import * as fs from "fs";
import * as path from "path";

import {Json} from "@chainsafe/ssz";

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
export async function writeFile(filename: string, obj: Json): Promise<void> {
  const fileFormat = path.extname(filename).substr(1);
  let contents: string;
  switch (fileFormat) {
    case FileFormat.json:
      contents = JSON.stringify(obj, null, 2);
      break;
    default:
      throw new Error("Invalid filetype");
  }
  await fs.promises.writeFile(filename, contents, "utf-8");
}


/**
 * Read a JSON serializable object from a file
 *
 * Parse either from json, yaml, or toml
 */
export async function readFile<T=Json>(filename: string): Promise<T> {
  const fileFormat = path.extname(filename).substr(1);
  const contents = await fs.promises.readFile(filename, "utf-8");
  switch (fileFormat) {
    case FileFormat.json:
      return JSON.parse(contents);
    default:
      throw new Error("Invalid filetype");
  }
}
