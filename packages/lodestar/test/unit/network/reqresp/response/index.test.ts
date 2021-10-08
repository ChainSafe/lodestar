import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {AbortController} from "@chainsafe/abort-controller";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {RespStatus} from "../../../../../src/constants";
import {Method, Encoding, Version} from "../../../../../src/network/reqresp/types";
import {handleRequest, PerformRequestHandler} from "../../../../../src/network/reqresp/response";
import {expectRejectedWithLodestarError} from "../../../../utils/errors";
import {expectEqualByteChunks, MockLibP2pStream} from "../utils";
import {sszSnappyPing} from "../encodingStrategies/sszSnappy/testData";
import {testLogger} from "../../../../utils/logger";
import {getValidPeerId} from "../../../../utils/peer";
import {createNode} from "../../../../utils/network";
import {config} from "../../../../utils/config";

chai.use(chaiAsPromised);

describe("network / reqresp / response / handleRequest", async () => {
  const logger = testLogger();
  const peerId = getValidPeerId();
  const multiaddr = "/ip4/127.0.0.1/tcp/0";
  const libp2p = await createNode(multiaddr);

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  const testCases: {
    id: string;
    method: Method;
    encoding: Encoding;
    requestChunks: Buffer[];
    performRequestHandler: PerformRequestHandler;
    expectedResponseChunks: Buffer[];
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
        ...sszSnappyPing.chunks,
        // Chunk 1 - success, Ping, BigInt(1)
        Buffer.from([RespStatus.SUCCESS]),
        ...sszSnappyPing.chunks,
        // Chunk 2 - error, with errorMessage
        Buffer.from([RespStatus.SERVER_ERROR]),
        Buffer.from("TEST_ERROR"),
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
        {config, logger, libp2p},
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
