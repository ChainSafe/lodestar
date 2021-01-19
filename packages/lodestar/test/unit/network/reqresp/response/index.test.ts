import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import PeerId from "peer-id";
import {config} from "@chainsafe/lodestar-config/minimal";
import {LodestarError, LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../../../../src/constants";
import {ReqRespHandler} from "../../../../../src/network";
import {handleRequest} from "../../../../../src/network/reqresp/response";
import {expectRejectedWithLodestarError} from "../../../../utils/errors";
import {expectEqualByteChunks, MockLibP2pStream} from "../utils";
import {sszSnappyPing} from "../encodingStrategies/sszSnappy/testData";

chai.use(chaiAsPromised);

describe("network / reqresp / response / handleRequest", () => {
  // Use LogLevel.verbose to debug tests if necessary
  const logger = new WinstonLogger({level: LogLevel.error});
  const peerId = new PeerId(new Uint8Array([1]));

  const testCases: {
    id: string;
    method: Method;
    encoding: ReqRespEncoding;
    requestChunks: Buffer[];
    performRequestHandler: ReqRespHandler;
    expectedResponseChunks: Buffer[];
    expectedError?: LodestarError<any>;
  }[] = [
    {
      id: "Yield two chunks, then throw",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      requestChunks: sszSnappyPing.chunks, // Request Ping: BigInt(1)
      performRequestHandler: async function* () {
        yield sszSnappyPing.body;
        yield sszSnappyPing.body;
        throw new LodestarError({code: "TEST_ERROR"});
      },
      expectedError: new LodestarError({code: "TEST_ERROR"}),
      expectedResponseChunks: [
        // Chunk 0 - success, Ping, BigInt(1)
        Buffer.from([RpcResponseStatus.SUCCESS]),
        ...sszSnappyPing.chunks,
        // Chunk 1 - success, Ping, BigInt(1)
        Buffer.from([RpcResponseStatus.SUCCESS]),
        ...sszSnappyPing.chunks,
        // Chunk 2 - error, with errorMessage
        Buffer.from([RpcResponseStatus.SERVER_ERROR]),
        Buffer.from("TEST_ERROR"),
      ],
    },
  ];

  for (const {
    id,
    method,
    encoding,
    requestChunks,
    performRequestHandler,
    expectedResponseChunks,
    expectedError,
  } of testCases) {
    it(id, async () => {
      const stream = new MockLibP2pStream(requestChunks);

      const resultPromise = handleRequest({config, logger}, performRequestHandler, stream, peerId, method, encoding);

      // Make sure the test error-ed with expected error, otherwise it's hard to debug with responseChunks
      if (expectedError) {
        await expectRejectedWithLodestarError(resultPromise, expectedError);
      } else {
        await expect(resultPromise).to.not.rejectedWith();
      }

      expectEqualByteChunks(stream.resultChunks, expectedResponseChunks, "Wrong response chunks");
    });
  }
});
