import path from "node:path";
import {fileURLToPath} from "node:url";
import {config} from "@lodestar/config/default";
import {OpenApiFile} from "../../utils/parseOpenApiSpec.js";
import {getDefinitions} from "../../../src/keymanager/routes.js";
import {runTestCheckAgainstSpec} from "../../utils/checkAgainstSpec.js";
import {fetchOpenApiSpec} from "../../utils/fetchOpenApiSpec.js";
import {testData} from "./testData.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const version = "v1.1.0";
const openApiFile: OpenApiFile = {
  url: `https://github.com/ethereum/keymanager-APIs/releases/download/${version}/keymanager-oapi.json`,
  filepath: path.join(__dirname, "../../../oapi-schemas/keymanager-oapi.json"),
  version: RegExp(version),
};

const openApiJson = await fetchOpenApiSpec(openApiFile);
runTestCheckAgainstSpec(openApiJson, getDefinitions(config), testData);
