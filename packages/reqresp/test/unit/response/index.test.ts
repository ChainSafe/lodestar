import {expect} from "chai";
import {Uint8ArrayList} from "uint8arraylist";
import {PeerId} from "@libp2p/interface-peer-id";
import {LodestarError, fromHex, Logger} from "@lodestar/utils";
import {ProtocolDefinition, RespStatus} from "../../../src/index.js";
import {sszSnappyPing} from "../../fixtures/messages.js";
import {Ping} from "../../../src/protocols/index.js";
import {expectEqualByteChunks, MockLibP2pStream} from "../../utils/index.js";
import {handleRequest} from "../../../src/response/index.js";
import {createStubbedLogger} from "../../mocks/logger.js";
import {getValidPeerId} from "../../utils/peer.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {ReqRespRateLimiter} from "../../../src/rate_limiter/ReqRespRateLimiter.js";

const testCases: {
  id: string;
  protocol: ProtocolDefinition<any, any>;
  requestChunks: Uint8ArrayList[];
  expectedResponseChunks: Uint8Array[];
  expectedError?: LodestarError<any>;
}[] = [
  {
    id: "Yield two chunks, then throw",
    protocol: Ping(async function* () {
      yield sszSnappyPing.payload;
      yield sszSnappyPing.payload;
      throw new LodestarError({code: "TEST_ERROR"});
    }),
    requestChunks: sszSnappyPing.chunks, // Request Ping: BigInt(1)
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

describe("response / handleRequest", () => {
  let controller: AbortController;
  let logger: Logger;
  let peerId: PeerId;

  beforeEach(() => {
    controller = new AbortController();
    peerId = getValidPeerId();
    logger = createStubbedLogger();
  });

  afterEach(() => controller.abort());

  for (const {id, requestChunks, protocol, expectedResponseChunks, expectedError} of testCases) {
    it(id, async () => {
      const stream = new MockLibP2pStream(requestChunks);
      const rateLimiter = new ReqRespRateLimiter({rateLimitMultiplier: 0});

      const resultPromise = handleRequest({
        logger,
        protocol,
        protocolID: protocol.method,
        stream,
        peerId,
        signal: controller.signal,
        rateLimiter,
      });

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
