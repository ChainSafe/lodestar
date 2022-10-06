import {expect} from "chai";
import {Uint8ArrayList} from "uint8arraylist";
import {LodestarError, fromHex} from "@lodestar/utils";
import {RespStatus} from "../../../../../src/constants/index.js";
import {Method, Encoding, Version} from "../../../../../src/network/reqresp/types.js";
import {handleRequest, PerformRequestHandler} from "../../../../../src/network/reqresp/response/index.js";
import {PeersData} from "../../../../../src/network/peers/peersData.js";
import {expectRejectedWithLodestarError} from "../../../../utils/errors.js";
import {expectEqualByteChunks, MockLibP2pStream} from "../utils.js";
import {sszSnappyPing} from "../encodingStrategies/sszSnappy/testData.js";
import {testLogger} from "../../../../utils/logger.js";
import {getValidPeerId} from "../../../../utils/peer.js";
import {config} from "../../../../utils/config.js";

describe("network / reqresp / response / handleRequest", () => {
  const logger = testLogger();
  const peerId = getValidPeerId();
  const peersData = new PeersData();

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  const testCases: {
    id: string;
    method: Method;
    encoding: Encoding;
    requestChunks: Uint8ArrayList[];
    performRequestHandler: PerformRequestHandler;
    expectedResponseChunks: Uint8Array[];
    expectedError?: LodestarError<any>;
  }[] = [
    {
      id: "Yield two chunks, then throw",
      method: Method.Ping,
      encoding: Encoding.SSZ_SNAPPY,
      requestChunks: sszSnappyPing.chunks, // Request Ping: BigInt(1)
      performRequestHandler: async function* () {
        yield sszSnappyPing.body;
        yield sszSnappyPing.body;
        throw new LodestarError({code: "TEST_ERROR"});
      },
      expectedError: new LodestarError({code: "TEST_ERROR"}),
      expectedResponseChunks: [
        // Chunk 0 - success, Ping, BigInt(1)
        Buffer.from([RespStatus.SUCCESS]),
        ...sszSnappyPing.chunks.map((c) => c.subarray()),
        // Chunk 1 - success, Ping, BigInt(1)
        Buffer.from([RespStatus.SUCCESS]),
        ...sszSnappyPing.chunks.map((c) => c.subarray()),
        // Chunk 2 - error, with errorMessage
        Buffer.from([RespStatus.SERVER_ERROR]),
        Buffer.from(fromHex("0x0a")),
        Buffer.from(fromHex("0xff060000734e61507059010e000049b97aaf544553545f4552524f52")),
      ],
    },
  ];

  const version = Version.V1;

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

      const resultPromise = handleRequest(
        {config, logger, peersData: peersData},
        performRequestHandler,
        stream,
        peerId,
        {method, version, encoding},
        controller.signal
      );

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
