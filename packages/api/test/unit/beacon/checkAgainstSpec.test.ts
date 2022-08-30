import path from "node:path";
import {fileURLToPath} from "node:url";
import {config} from "@lodestar/config/default";
import {OpenApiFile} from "../../utils/parseOpenApiSpec.js";
import {routes} from "../../../src/beacon/index.js";
import {runTestCheckAgainstSpec} from "../../utils/checkAgainstSpec.js";
// Import all testData and merge below
import {testData as beaconTestData} from "./testData/beacon.js";
import {testData as configTestData} from "./testData/config.js";
import {testData as debugTestData} from "./testData/debug.js";
import {testData as lightclientTestData} from "./testData/lightclient.js";
import {testData as nodeTestData} from "./testData/node.js";
import {testData as validatorTestData} from "./testData/validator.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const version = "v2.3.0";
const openApiFile: OpenApiFile = {
  url: `https://github.com/ethereum/beacon-APIs/releases/download/${version}/beacon-node-oapi.json`,
  filepath: path.join(__dirname, "../../../oapi-schemas/beacon-node-oapi.json"),
  version: RegExp(version),
};

const routesData = {
  ...routes.beacon.routesData,
  ...routes.config.routesData,
  ...routes.debug.routesData,
  ...routes.lightclient.routesData,
  ...routes.node.routesData,
  ...routes.validator.routesData,
};

const reqSerializers = {
  ...routes.beacon.getReqSerializers(config),
  ...routes.config.getReqSerializers(),
  ...routes.debug.getReqSerializers(),
  ...routes.lightclient.getReqSerializers(),
  ...routes.node.getReqSerializers(),
  ...routes.validator.getReqSerializers(),
};

const returnTypes = {
  ...routes.beacon.getReturnTypes(),
  ...routes.config.getReturnTypes(),
  ...routes.debug.getReturnTypes(),
  ...routes.lightclient.getReturnTypes(),
  ...routes.node.getReturnTypes(),
  ...routes.validator.getReturnTypes(),
};

const testDatas = {
  ...beaconTestData,
  ...configTestData,
  ...debugTestData,
  ...lightclientTestData,
  ...nodeTestData,
  ...validatorTestData,
};

await runTestCheckAgainstSpec(openApiFile, routesData, reqSerializers, returnTypes, testDatas);
