import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import $RefParser, { JSONSchema } from "@apidevtools/json-schema-ref-parser";
import { MethodDefinition, MethodName, OpenRpcJson } from "./parseOpenRpcSpec";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localFolderPath = path.join(__dirname, "../../openrpc/");
const masterSchemaPath = path.join(localFolderPath, "execution-engine-api.json");


export type EngineApiSpecRepo = {
  url: string, // Url to the github repo
  specFolder: string, // Folder containing the spec files
  baseSchema: string, // Folder containing the base schemas
  commit: string, // Commit hash
}

// Fetch contents of a GitHub directory
async function fetchGitHubContents(engineApiSpecRepo: EngineApiSpecRepo, dir: string): Promise<any> {
  const response = await fetch(`${engineApiSpecRepo.url}/${dir}?ref=${engineApiSpecRepo.commit}`, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

/**
 * Download a single file from GitHub to `filePath`.
 */
async function downloadFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  // Asynchronously write the file
  await fs.writeFile(filePath, Buffer.from(buffer));
  console.log(`Downloaded: ${filePath}`);
}

/**
 * Recursively download all files and folders from a GitHub directory starting from dir
 */
async function downloadDirectory(engineApiSpecRepo: EngineApiSpecRepo, dir: string, localPath: string): Promise<void> {
  const contents = await fetchGitHubContents(engineApiSpecRepo, dir);

  // Ensure the localPath directory exists (async)
  await fs.mkdir(localPath, { recursive: true });

  for (const item of contents) {
    const itemPath = path.join(localPath, item.name);

    if (item.type === "file") {
      await downloadFile(item.download_url, itemPath);
    } else if (item.type === "dir") {
      // Recurse into subdirectory
      await downloadDirectory(engineApiSpecRepo, `${dir}/${item.name}`, itemPath);
    }
  }
}

/**
 * Read all .yaml files in `dir` and merge them into a single JSONSchema object.
 */
async function parseSchemasInDirectory(dir: string): Promise<JSONSchema> {
  const fileNames = await fs.readdir(dir);
  let result = {};

  for (const fileName of fileNames) {
    if (fileName.endsWith(".yaml")) {
      const fullPath = path.join(dir, fileName);
      const content = await fs.readFile(fullPath, "utf8");
      const parsed = parseYaml(content) as JSONSchema;
      // Merge the parsed object into `result`
      result = { ...result, ...parsed };
    }
  }
  return result;
}

/**
 * Read all .yaml files in `dir`, each containing an array of methods,
 * and merge them into a record keyed by method name.
 */
async function parseMethodsInDirectory(dir: string): Promise<Record<MethodName, MethodDefinition>> {
  const fileNames = await fs.readdir(dir);
  let result: Record<string, MethodDefinition> = {};

  for (const fileName of fileNames) {
    if (fileName.endsWith(".yaml")) {
      const fullPath = path.join(dir, fileName);
      const content = await fs.readFile(fullPath, "utf8");
      // Each file presumably has an array of methods
      const parsed = parseYaml(content) as MethodDefinition[];

      for (const method of parsed) {
        const methodName = method.name as MethodName;
        result = { ...result, [methodName]: method };
      }
    }
  }
  return result;
}

/**
 * 1. Download all necessary raw spec YAML files from GitHub into local.
 * 2. Read local YAMLs, combine (and dereference) them into a single JSON object named master schema.
 * 3. Store the single JSON object into a local JSON file `execution-engine-api.json`.
 */
export async function fetchOpenRpcSpec(engineApiSpecRepo: EngineApiSpecRepo): Promise<OpenRpcJson> {
  // 1) If the master schema file already exists, just load & return it
  try {
    await fs.access(masterSchemaPath); // checks if file exists
    console.log("Openrpc spec file already exists");
    const content = await fs.readFile(masterSchemaPath, "utf8");
    return JSON.parse(content) as OpenRpcJson;
  } catch {
    console.log("Openrpc spec file not found. Proceed to download and generate");
  }

  // 2) Download raw spec files (if local folder doesn't exist)
  try {
    await fs.access(localFolderPath);
    console.log("Raw spec files already exist");
  } catch {
    console.log("Downloading raw spec files...");
    await downloadDirectory(engineApiSpecRepo, engineApiSpecRepo.specFolder, localFolderPath);
    await downloadDirectory(engineApiSpecRepo, engineApiSpecRepo.baseSchema, localFolderPath);
  }

  // 3) Parse local YAML files from each folder
  const baseFolder = localFolderPath;
  const engineSchemaFolder = path.join(localFolderPath, "schemas");
  const engineMethodFolder = path.join(localFolderPath, "methods");

  const typeObj   = await parseSchemasInDirectory(baseFolder);
  const schemaObj = await parseSchemasInDirectory(engineSchemaFolder);
  const methodObj = await parseMethodsInDirectory(engineMethodFolder);

  // 4) Combine them into a single object
  const combined: OpenRpcJson = {
    components: {
      schemas: {
        ...schemaObj,
        ...typeObj,
      },
    },
    methods: {
      ...methodObj,
    },
  };

  // 5) Dereference any $ref
  const dereferenced = await $RefParser.dereference<OpenRpcJson>(combined);

  // 6) Write the final JSON to disk
  await fs.writeFile(masterSchemaPath, JSON.stringify(dereferenced, null, 2), "utf8");

  console.log(`Generated openrpc spec file: ${masterSchemaPath}`);
  return dereferenced;
}
