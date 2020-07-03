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
    await fs.promises.mkdir(filename, {recursive: true});
  }
}

export enum FileFormat {
  json = "json",
  yaml = "yaml",
  toml = "toml",
}

export function parse<T=Json>(contents: string, fileFormat: FileFormat): T {
  switch (fileFormat) {
    case FileFormat.json:
      return JSON.parse(contents);
    default:
      throw new Error("Invalid filetype");
  }
}
export function stringify<T=Json>(obj: T, fileFormat: FileFormat): string {
  let contents: string;
  switch (fileFormat) {
    case FileFormat.json:
      contents = JSON.stringify(obj, null, 2);
      break;
    default:
      throw new Error("Invalid filetype");
  }
  return contents;
}

/**
 * Write a JSON serializable object to a file
 *
 * Serialize either to json, yaml, or toml
 */
export async function writeFile(filename: string, obj: Json): Promise<void> {
  const fileFormat = path.extname(filename).substr(1);
  await fs.promises.writeFile(filename, stringify(obj, fileFormat as FileFormat), "utf-8");
}


/**
 * Read a JSON serializable object from a file
 *
 * Parse either from json, yaml, or toml
 */
export async function readFile<T=Json>(filename: string): Promise<T> {
  const fileFormat = path.extname(filename).substr(1);
  const contents = await fs.promises.readFile(filename, "utf-8");
  return parse(contents, fileFormat as FileFormat);
}

export function readFileSync<T=Json>(filename: string): T {
  const fileFormat = path.extname(filename).substr(1);
  const contents = fs.readFileSync(filename, "utf-8");
  return parse(contents, fileFormat as FileFormat);
}
