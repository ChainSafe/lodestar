import path from "node:path";
import {fileURLToPath} from "node:url";
import {createIChainForkConfig, defaultChainConfig} from "@lodestar/config";

import {OpenApiFile} from "../../utils/parseOpenApiSpec.js";
import {routesData, getReqSerializers, getReturnTypes} from "../../../src/builder/routes.js";
import {runTestCheckAgainstSpec} from "../../utils/checkAgainstSpec.js";
import {fetchOpenApiSpec} from "../../utils/fetchOpenApiSpec.js";
import {testData} from "./testData.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const version = "v0.2.0";
const openApiFile: OpenApiFile = {
  url: `https://github.com/ethereum/builder-specs/releases/download/${version}/builder-oapi.json`,
  filepath: path.join(__dirname, "../../../oapi-schemas/builder-oapi.json"),
  // TODO: file version is 'dev'
  // https://github.com/ethereum/builder-specs/blob/b66471c67f24b6c29a3e5461720c8620310815c6/builder-oapi.yaml#L22
  version: RegExp(/.*/),
};

const reqSerializers = getReqSerializers(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  createIChainForkConfig({...defaultChainConfig, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0})
);
const returnTypes = getReturnTypes();

const openApiJson = await fetchOpenApiSpec(openApiFile);
runTestCheckAgainstSpec(openApiJson, routesData, reqSerializers, returnTypes, testData);
