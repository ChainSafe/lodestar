import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, it} from "vitest";
import {SignableMessageType, getDefinitions} from "../../../src/signer/routes.js";
import {runTestCheckAgainstSpec, validateSchema} from "../../utils/checkAgainstSpec.js";
import {fetchOpenApiSpec} from "../../utils/fetchOpenApiSpec.js";
import {OpenApiFile, parseOpenApiSpec} from "../../utils/parseOpenApiSpec.js";
import {signRequests, testData} from "./testData.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const version = "v1.4.0";
const openApiFile: OpenApiFile = {
  url: `https://github.com/ethereum/remote-signing-api/releases/download/${version}/remote-signing-oapi.json`,
  filepath: path.join(__dirname, "../../../oapi-schemas/remote-signing-oapi.json"),
  version: RegExp(version),
};

// Message types added to the Lodestar remote signer client before they are part of a released spec version
const typesNotInSpec = new Set<SignableMessageType>([SignableMessageType.INCLUSION_LIST]);

const definitions = getDefinitions();

// The spec names operations in upper case, map them to the route ids
const specDefinitions = {SIGN: definitions.sign, PUBLIC_KEY_LIST: definitions.listPublicKeys};
const specTestData = {SIGN: testData.sign, PUBLIC_KEY_LIST: testData.listPublicKeys};

const openApiJson = await fetchOpenApiSpec(openApiFile);
runTestCheckAgainstSpec(openApiJson, specDefinitions, specTestData);

describe("SIGN request body for every message type", () => {
  const signSpec = parseOpenApiSpec(openApiJson).get("SIGN");
  if (signSpec === undefined) {
    throw Error("SIGN operation not found in spec");
  }

  for (const [name, request] of Object.entries(signRequests)) {
    it(name, ({skip}) => {
      if (typesNotInSpec.has(request.message.type)) {
        skip();
        return;
      }
      const reqJson = definitions.sign.req.writeReqJson(request);
      validateSchema(signSpec.requestSchema, {params: reqJson.params, body: reqJson.body}, `request ${name}`);
    });
  }
});
