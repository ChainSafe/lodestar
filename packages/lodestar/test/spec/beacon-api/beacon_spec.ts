// Set up Chai
import path from "node:path";
import {fileURLToPath} from "node:url";
import fs from "node:fs";
import chai from "chai";

const expect = chai.expect;
import {HttpClient} from "@chainsafe/lodestar-api";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {LogLevel, testLogger, TestLoggerOpts} from "../../utils/logger.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {isValidResponse} from "./util/api_response_validator.js";

const restPort = 9596;

const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
const loggerNodeA = testLogger("Node-A", testLoggerOpts);

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SPEC_FILE: Record<string, unknown> = (JSON.parse(
  fs.readFileSync(path.join(__dirname, "beacon-node-oapi-v2-1-0.json"), {
    encoding: "utf8",
  })
) as unknown) as Record<string, unknown>;

const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  SECONDS_PER_SLOT: 2,
};

type BeaconDataResponse = {
  data: Record<string, unknown>;
};

const bn = await getDevBeaconNode({
  params: testParams,
  options: {
    sync: {isSingleNode: true},
    api: {rest: {enabled: true, port: restPort}},
  },
  logger: loggerNodeA,
});

// TODOS
// See how to avoid eslint-disable

const testCases = [
  {
    specPath: "/eth/v1/beacon/genesis",
    testUrl: "/eth/v1/beacon/genesis",
    method: "get",
  },
  {
    specPath: "/eth/v1/beacon/states/{state_id}/root",
    testUrl: "/eth/v1/beacon/states/head/root",
    method: "get",
  },
  {
    specPath: "/eth/v1/beacon/states/{state_id}/fork",
    testUrl: "/eth/v1/beacon/states/head/fork",
    method: "get",
  },
];

/* eslint-disable @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access */
describe("beacon api conformance test", function () {
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEachCallbacks.push(() => bn.close());
  after(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  describe("beacon", function () {
    const baseUrl = `http://127.0.0.1:${restPort}`;
    const httpClient = new HttpClient({baseUrl});

    testCases.forEach((testCase) => {
      it(testCase.specPath, async function () {
        const resBody = await httpClient.json<BeaconDataResponse>({url: testCase.testUrl, method: "GET"});

        const validatorResponse = isValidResponse(resBody, SPEC_FILE, {
          path: testCase.specPath,
          method: testCase.method.toLowerCase() as "get" | "post" | "put",
          status: 200,
        });

        expect(validatorResponse.isValid, `validating response for path: ${path} failed)}`).to.be.true;
      });
    });
  });
});
