import fs from "fs";
import path from "path";
import stream from "stream";
import {promisify} from "util";
import got from "got";
import {load, dump, FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {Json} from "@chainsafe/ssz";
import {ensureDirExists} from "./fs";

export const yamlSchema = new Schema({
  include: [FAILSAFE_SCHEMA],
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function (data) {
        return data !== null ? data : "";
      },
    }),
  ],
});

/**
 * Maybe create a directory
 */
export function mkdir(dirname: string): void {
  fs.mkdirSync(dirname, {recursive: true});
}

export enum FileFormat {
  json = "json",
  yaml = "yaml",
  toml = "toml",
}

export function parse<T = Json>(contents: string, fileFormat: FileFormat): T {
  switch (fileFormat) {
    case FileFormat.json:
      return JSON.parse(contents);
    case FileFormat.yaml:
      return load(contents, {schema: yamlSchema});
    default:
      throw new Error("Invalid filetype");
  }
}
export function stringify<T = Json>(obj: T, fileFormat: FileFormat): string {
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
export function writeFile(filename: string, obj: Json): void {
  ensureDirExists(path.parse(filename).dir);
  const fileFormat = path.extname(filename).substr(1);
  fs.writeFileSync(filename, stringify(obj, fileFormat as FileFormat), "utf-8");
}

/**
 * Read a JSON serializable object from a file
 *
 * Parse either from json, yaml, or toml
 */
export function readFile<T = Json>(filename: string): T {
  const fileFormat = path.extname(filename).substr(1);
  const contents = fs.readFileSync(filename, "utf-8");
  return parse(contents, fileFormat as FileFormat);
}

/**
 * Download from URL or copy from local filesystem
 * @param urlOrPathSrc "/path/to/file.szz" | "https://url.to/file.szz"
 */
export async function downloadOrCopyFile(pathDest: string, urlOrPathSrc: string): Promise<void> {
  if (urlOrPathSrc.startsWith("http")) {
    await downloadFile(pathDest, urlOrPathSrc);
  } else {
    fs.mkdirSync(path.parse(pathDest).dir, {recursive: true});
    await fs.promises.copyFile(urlOrPathSrc, pathDest);
  }
}

/**
 * Downloads a genesis file per testnet if it does not exist
 */
export async function downloadFile(filepath: string, url: string): Promise<void> {
  if (!fs.existsSync(filepath)) {
    fs.mkdirSync(path.parse(filepath).dir, {recursive: true});
    await promisify(stream.pipeline)(got.stream(url), fs.createWriteStream(filepath));
  }
}
