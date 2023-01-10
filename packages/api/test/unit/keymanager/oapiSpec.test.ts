import path from "node:path";
import {fileURLToPath} from "node:url";
import {OpenApiFile} from "../../utils/parseOpenApiSpec.js";
import {routesData, getReqSerializers, getReturnTypes} from "../../../src/keymanager/routes.js";
import {runTestCheckAgainstSpec} from "../../utils/checkAgainstSpec.js";
import {fetchOpenApiSpec} from "../../utils/fetchOpenApiSpec.js";
import {testData} from "./testData.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const version = "v1.0.0";
const openApiFile: OpenApiFile = {
  url: `https://github.com/ethereum/keymanager-APIs/releases/download/${version}/keymanager-oapi.json`,
  filepath: path.join(__dirname, "../../../oapi-schemas/keymanager-oapi.json"),
  version: RegExp(version),
};

// TODO: un-skip in follow-up PR, this PR only adds basic infra for spec testing
const reqSerializers = getReqSerializers();
const returnTypes = getReturnTypes();

const openApiJson = await fetchOpenApiSpec(openApiFile);
runTestCheckAgainstSpec(openApiJson, routesData, reqSerializers, returnTypes, testData);
