import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import PeerId from "peer-id";
import {config} from "@chainsafe/lodestar-config/minimal";
import {LodestarError, LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {Method, ReqRespEncoding} from "../../../../../src/constants";
import {ReqRespHandler} from "../../../../../src/network";
import {handleRequest} from "../../../../../src/network/reqresp/response";
import {expectRejectedWithLodestarError, MockLibP2pStream} from "../utils";

chai.use(chaiAsPromised);

describe("network / reqresp / response / handleRequest", () => {
  // Use LogLevel.verbose to debug tests if necessary
  const logger = new WinstonLogger({level: LogLevel.error});
  const peerId = new PeerId(new Uint8Array([1]));

  const testCases: {
    id: string;
    method: Method;
    encoding: ReqRespEncoding;
    requestChunks: string[];
    performRequestHandler: ReqRespHandler;
    expectedResponseChunks: string[];
    expectedError?: LodestarError<any>;
  }[] = [
    {
      id: "Yield two chunks, then throw",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      requestChunks: [
        "0x08", // length prefix
        "0xff060000734e61507059", // snappy frames header
        "0x010c00000175de410100000000000000", // snappy frames content
      ],
      performRequestHandler: async function* () {
        yield BigInt(1);
        yield BigInt(1);
        throw new LodestarError({code: "TEST_ERROR"});
      },
      expectedError: new LodestarError({code: "TEST_ERROR"}),
      expectedResponseChunks: [
        // Chunk 0 - success
        "0x00", // status: success
        "0x08", // length prefix
        "0xff060000734e61507059", // snappy frames header
        "0x010c00000175de410100000000000000", // snappy frames content
        // Chunk 1 - success
        "0x00",
        "0x08",
        "0xff060000734e61507059",
        "0x010c00000175de410100000000000000",
        // Error
        "0x02",
        "0x544553545f4552524f52",
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

      expect(stream.isClosed).to.equal(true, "Stream was not closed");
      expect(stream.resultChunks.map(toHexString)).to.deep.equal(expectedResponseChunks, "Wrong response chunks");
    });
  }
});
