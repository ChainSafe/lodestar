import path from "path";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {Goodbye, Metadata, Ping, ResponseBody, Status, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../../../../src/constants";
import {sendResponseStream} from "../../../../../src/network/reqresp/respUtils";
import {generateSignedBlock} from "../../../../utils/block";
import {writeNetworkResponseTestData} from "../format/response";
import {testDirResponse} from "../paths";

// To generate new test vectors run
// ```
// npx mocha test/unit/network/spec-tests/generate/*.gen.test
// ```

interface ITestDataToGenerate<T extends ResponseBody> {
  testId: string;
  method: Method;
  result: RpcResponseStatus;
  responseBody: T[];
}

describe("Network test data - generate response data", () => {
  const logger = new WinstonLogger();
  const requestId = "request-id-sample";
  const encoding = ReqRespEncoding.SSZ_SNAPPY;

  function generateTestCase<T extends ResponseBody>(data: ITestDataToGenerate<T>): void {
    it(data.testId, async () => {
      let chunks: Buffer[] = [];

      async function sink(source: AsyncIterable<Buffer>): Promise<void> {
        chunks = await all(source);
      }

      async function* chunkIter(): AsyncGenerator<ResponseBody> {
        if (!data.responseBody) {
          return null;
        }

        for (const response of data.responseBody) {
          yield response;
        }
      }

      await sendResponseStream({config, logger}, requestId, data.method, encoding, sink as any, null, chunkIter());

      const testDir = path.join(testDirResponse, data.testId);
      writeNetworkResponseTestData(testDir, {
        result: data.result,
        method: data.method,
        encoding: ReqRespEncoding.SSZ_SNAPPY,
        chunks,
        responseBody: Array.isArray(data.responseBody) ? data.responseBody : [data.responseBody],
      });
    });
  }

  generateTestCase<Status>({
    testId: "status_success",
    method: Method.Status,
    result: RpcResponseStatus.SUCCESS,
    responseBody: [
      {
        forkDigest: Buffer.alloc(4, 1),
        finalizedRoot: Buffer.alloc(32, 2),
        finalizedEpoch: 3,
        headRoot: Buffer.alloc(32, 4),
        headSlot: 5,
      },
    ],
  });

  generateTestCase<Goodbye>({
    testId: "goodbye_success",
    method: Method.Goodbye,
    result: RpcResponseStatus.SUCCESS,
    responseBody: [BigInt(1)],
  });

  generateTestCase<Ping>({
    testId: "ping_success",
    method: Method.Ping,
    result: RpcResponseStatus.SUCCESS,
    responseBody: [BigInt(24)],
  });

  generateTestCase<Metadata>({
    testId: "status_success",
    method: Method.Metadata,
    result: RpcResponseStatus.SUCCESS,
    responseBody: [
      {
        seqNumber: BigInt(4),
        attnets: [false, true, true, true],
      },
    ],
  });

  generateTestCase<SignedBeaconBlock>({
    testId: "beacon_blocks_by_range_success",
    method: Method.BeaconBlocksByRange,
    result: RpcResponseStatus.SUCCESS,
    responseBody: [generateSignedBlock({}, 0xda), generateSignedBlock({}, 0xdb)],
  });

  generateTestCase<SignedBeaconBlock>({
    testId: "beacon_blocks_by_root_success",
    method: Method.BeaconBlocksByRoot,
    result: RpcResponseStatus.SUCCESS,
    responseBody: [generateSignedBlock({}, 0xda), generateSignedBlock({}, 0xdb)],
  });

  // it("Status ERROR", async () => {
  //   const error = new RpcError(RpcResponseStatus.SERVER_ERROR, "Something went wrong");
  //   await sendResponse({config, logger}, requestId, method, encoding, sink as any, error);
  // });
});
