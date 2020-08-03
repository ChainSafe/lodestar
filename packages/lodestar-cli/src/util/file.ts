import * as fs from "fs";
import * as path from "path";
import {load, dump, FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {Json} from "@chainsafe/ssz";
import {ensureDirExists} from "./fs";

export const yamlSchema = new Schema({
  include: [
    FAILSAFE_SCHEMA
  ],
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function (data) { return data !== null ? data : ""; }
    })
  ]
});

/**
 * Maybe create a directory
 */
export async function mkdir(dirname: string): Promise<void> {
  await fs.promises.mkdir(dirname, {recursive: true});
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
    case FileFormat.yaml:
      return load(contents, {schema: yamlSchema});
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
    case FileFormat.yaml:
      contents = dump(obj, {schema: yamlSchema});
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
  ensureDirExists(path.parse(filename).dir);
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
