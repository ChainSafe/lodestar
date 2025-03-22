import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import $RefParser from "@apidevtools/json-schema-ref-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localFolderPath = path.join(__dirname, "../../openrpc/")
const masterSchemaPath = path.join(localFolderPath, "execution-engine-api.json");


const SPEC_REPO_URL = "https://api.github.com/repos/ethereum/execution-apis/contents";
const ENGINE_SPEC_FOLDER = "src/engine/openrpc";
const BASE_SCHEMA = "src/schemas";

const SPEC_COMMIT = "10f58fbface95676780ee7328091a494e9584a6e"; // Update as we need

// Fetch contents of a GitHub directory
async function fetchGitHubContents(dir: string): Promise<any> {
  try {
    const response = await fetch(`${SPEC_REPO_URL}/${dir}?ref=${SPEC_COMMIT}`, {
    headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  } catch (e) {
    console.error(`Error fetching contents of Github directory: ${dir}`);
    throw e;
  }
}
  
// Download a file from GitHub
async function downloadFile(url: string, filePath: string): Promise<void> {
try {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(buffer));
  console.log(`Downloaded: ${filePath}`);
} catch (e) {
  console.error(`Error downloading file: ${url}`);
  throw e;
}
}

// Recursively download files from a GitHub directory
async function downloadDirectory(dir: string, localPath: string): Promise<void> {
  const contents = await fetchGitHubContents(dir);

  for (const item of contents) {
    const itemPath = path.join(localPath, item.name);

    if (item.type === "file") {
      fs.mkdirSync(localPath, { recursive: true });
      await downloadFile(item.download_url, itemPath);
    } else if (item.type === "dir") {
      await downloadDirectory(`${dir}/${item.name}`, itemPath);
    }
  }
}


function parseSchemasInDirectory(dir: string) {
  const fileNames = fs.readdirSync(dir);
  let result = {};

  for (const fileName of fileNames) {
    if (fileName.endsWith(".yaml")) {
      const fullPath = path.join(dir, fileName);
      const content = fs.readFileSync(fullPath);

      const parsed = parseYaml(content.toString('utf-8')); 
      result = {...result, ...parsed};
    }
  }

  return result;
}

function parseMethodsInDirectory(dir: string) {
  const fileNames = fs.readdirSync(dir);
  let result = {};

  for (const fileName of fileNames) {
    if (fileName.endsWith(".yaml")) {
      const fullPath = path.join(dir, fileName);
      const content = fs.readFileSync(fullPath);

      const parsed = parseYaml(content.toString('utf-8')); 

      for (const method of parsed) {
        const methodName = method.name;
        result = {...result, [methodName]: method};
      }

    }
  }
  return result;
}

/**
 * 1. Download all necessary raw spec yaml files from github to local
 * 2. Read local yamls, combine (and dereference) them into a single JSON object named master schema
 * 3. Store the single JSON object into a local JSON `execution-engine-api.json`
 */
export async function fetchOpenRpcSpec(): Promise<void> {

  // If master schema exists, we don't need to fetch
  if (fs.existsSync(masterSchemaPath)) {
    console.log("Openrpc spec file already exists");
    return;
  }

  if (!fs.existsSync(localFolderPath)) {
    await downloadDirectory(ENGINE_SPEC_FOLDER, localFolderPath);
    await downloadDirectory(BASE_SCHEMA, localFolderPath);
    console.log("Downloaded raw spec files");
  } else {
    console.log("Raw spec files already exist");
  }


  // Parse every file into object in memory
  const baseFolder = localFolderPath;
  const engineSchemaFolder = path.join(localFolderPath, "schemas");
  const engineMethodFolder = path.join(localFolderPath, "methods");

  const typeObj = parseSchemasInDirectory(baseFolder);
  const schemaObj = parseSchemasInDirectory(engineSchemaFolder);
  const methodObj = parseMethodsInDirectory(engineMethodFolder);


  const combined = {
    components: {
      schemas: {
        ...schemaObj,
        ...typeObj,
      }
    },
    methods: {
      ...methodObj
    },
  };


  const dereferenced = await $RefParser.dereference(combined);

  fs.writeFileSync(masterSchemaPath, JSON.stringify(dereferenced));

  console.log(`Generated openrpc spec file: ${masterSchemaPath}`);
}



fetchOpenRpcSpec();