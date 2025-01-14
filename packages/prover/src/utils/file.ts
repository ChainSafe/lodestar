import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
const {load, FAILSAFE_SCHEMA, Type} = yaml;

enum FileFormat {
  json = "json",
  yaml = "yaml",
  yml = "yml",
  toml = "toml",
}

const yamlSchema = FAILSAFE_SCHEMA.extend({
  implicit: [
    new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function construct(data) {
        return data !== null ? data : "";
      },
    }),
  ],
});

/**
 * Parse file contents as Json.
 */
function parse<T>(contents: string, fileFormat: FileFormat): T {
  switch (fileFormat) {
    case FileFormat.json:
      return JSON.parse(contents) as T;
    case FileFormat.yaml:
    case FileFormat.yml:
      return load(contents, {schema: yamlSchema}) as T;
    default:
      return contents as unknown as T;
  }
}

/**
 * Read a JSON serializable object from a file
 *
 * Parse either from json, yaml, or toml
 * Optional acceptedFormats object can be passed which can be an array of accepted formats, in future can be extended to include parseFn for the accepted formats
 */
export function readFile<T>(filepath: string, acceptedFormats?: string[]): T {
  const fileFormat = path.extname(filepath).substr(1);
  if (acceptedFormats && !acceptedFormats.includes(fileFormat)) throw new Error(`UnsupportedFileFormat: ${filepath}`);
  const contents = fs.readFileSync(filepath, "utf-8");
  return parse(contents, fileFormat as FileFormat);
}
