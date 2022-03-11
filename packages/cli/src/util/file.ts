import fs from "node:fs";
import path from "node:path";
import stream from "node:stream";
import {promisify} from "node:util";
import got from "got";
import {load, dump, FAILSAFE_SCHEMA, Schema, Type} from "js-yaml";
import {Json} from "@chainsafe/ssz";

export const yamlSchema = new Schema({
  include: [FAILSAFE_SCHEMA],
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function construct(data) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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
  yml = "yml",
  toml = "toml",
}

/**
 * Parse file contents as Json.
 */
export function parse<T = Json>(contents: string, fileFormat: FileFormat): T {
  switch (fileFormat) {
    case FileFormat.json:
      return JSON.parse(contents) as T;
    case FileFormat.yaml:
    case FileFormat.yml:
      return load(contents, {schema: yamlSchema}) as T;
    default:
      return (contents as unknown) as T;
  }
}

/**
 * Stringify file contents.
 */
export function stringify<T = Json>(obj: T, fileFormat: FileFormat): string {
  let contents: string;
  switch (fileFormat) {
    case FileFormat.json:
      contents = JSON.stringify(obj, null, 2);
      break;
    case FileFormat.yaml:
    case FileFormat.yml:
      contents = dump(obj, {schema: yamlSchema});
      break;
    default:
      contents = (obj as unknown) as string;
  }
  return contents;
}

/**
 * Write a JSON serializable object to a file
 *
 * Serialize either to json, yaml, or toml
 */
export function writeFile(filepath: string, obj: Json): void {
  mkdir(path.dirname(filepath));
  const fileFormat = path.extname(filepath).substr(1);
  fs.writeFileSync(filepath, stringify(obj, fileFormat as FileFormat), "utf-8");
}

/**
 * Read a JSON serializable object from a file
 *
 * Parse either from json, yaml, or toml
 * Optional acceptedFormats object can be passed which can be an array of accepted formats, in future can be extended to include parseFn for the accepted formats
 */
export function readFile<T = Json>(filepath: string, acceptedFormats?: Json[]): T {
  const fileFormat = path.extname(filepath).substr(1);
  if (acceptedFormats && !acceptedFormats.includes(fileFormat)) throw new Error(`UnsupportedFileFormat: ${filepath}`);
  const contents = fs.readFileSync(filepath, "utf-8");
  return parse(contents, fileFormat as FileFormat);
}

/**
 * @see readFile
 * If `filepath` does not exist returns null
 */
export function readFileIfExists<T = Json>(filepath: string, acceptedFormats?: Json[]): T | null {
  try {
    return readFile(filepath, acceptedFormats);
  } catch (e) {
    if ((e as {code: string}).code === "ENOENT") {
      return null;
    } else {
      throw e;
    }
  }
}

/**
 * Download from URL or copy from local filesystem
 * @param urlOrPathSrc "/path/to/file.szz" | "https://url.to/file.szz"
 */
export async function downloadOrCopyFile(pathDest: string, urlOrPathSrc: string): Promise<void> {
  if (isUrl(urlOrPathSrc)) {
    await downloadFile(pathDest, urlOrPathSrc);
  } else {
    mkdir(path.dirname(pathDest));
    await fs.promises.copyFile(urlOrPathSrc, pathDest);
  }
}

/**
 * Downloads a genesis file per network if it does not exist
 */
export async function downloadFile(pathDest: string, url: string): Promise<void> {
  if (!fs.existsSync(pathDest)) {
    mkdir(path.dirname(pathDest));
    await promisify(stream.pipeline)(got.stream(url), fs.createWriteStream(pathDest));
  }
}

/**
 * Download from URL to memory or load from local filesystem
 * @param urlOrPathSrc "/path/to/file.szz" | "https://url.to/file.szz"
 */
export async function downloadOrLoadFile(pathOrUrl: string): Promise<Uint8Array> {
  if (isUrl(pathOrUrl)) {
    const res = await got.get(pathOrUrl, {encoding: "binary"});
    return res.rawBody;
  } else {
    return await fs.promises.readFile(pathOrUrl);
  }
}

/**
 * Returns boolean for whether the string is a URL.
 */
function isUrl(pathOrUrl: string): boolean {
  return pathOrUrl.startsWith("http");
}
