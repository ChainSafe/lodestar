import {expect} from "chai";
import all from "it-all";
import {pipe} from "it-pipe";
import {Uint8ArrayList} from "uint8arraylist";
import {Method, Encoding, RequestBody} from "../../../../../src/network/reqresp/types.js";
import {SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy/index.js";
import {requestEncode} from "../../../../../src/network/reqresp/encoders/requestEncode.js";
import {requestDecode} from "../../../../../src/network/reqresp/encoders/requestDecode.js";
import {sszSnappyPing} from "../encodingStrategies/sszSnappy/testData.js";
import {arrToSource, expectEqualByteChunks} from "../utils.js";

describe("network / reqresp / encoders / request - Success and error cases", () => {
  const testCases: {
    id: string;
    method: Method;
    encoding: Encoding;
    chunks: Uint8ArrayList[];
    // decode
    errorDecode?: string;
    // encode
    requestBody?: RequestBody;
  }[] = [
    {
      id: "Bad body",
      method: Method.Status,
      encoding: Encoding.SSZ_SNAPPY,
      errorDecode: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE,
      chunks: [new Uint8ArrayList(Buffer.from("4"))],
    },
    {
      id: "No body on Metadata - Ok",
      method: Method.Metadata,
      encoding: Encoding.SSZ_SNAPPY,
      requestBody: null,
      chunks: [],
    },
    {
      id: "No body on Status - Error",
      method: Method.Status,
      encoding: Encoding.SSZ_SNAPPY,
      errorDecode: SszSnappyErrorCode.SOURCE_ABORTED,
      chunks: [],
    },
    {
      id: "Regular request",
      method: Method.Ping,
      encoding: Encoding.SSZ_SNAPPY,
      requestBody: sszSnappyPing.body,
      chunks: sszSnappyPing.chunks,
    },
  ];

  for (const {id, method, encoding, errorDecode, requestBody, chunks} of testCases) {
    it(`${id} - requestDecode`, async () => {
      const promise = pipe(arrToSource(chunks), requestDecode({method, encoding}));
      if (errorDecode) {
        await expect(promise).to.be.rejectedWith(errorDecode);
      } else {
        await promise;
      }
    });

    if (requestBody !== undefined) {
      it(`${id} - requestEncode`, async () => {
        const encodedChunks = await pipe(requestEncode({method, encoding}, requestBody), all);
        expectEqualByteChunks(
          encodedChunks,
          chunks.map((c) => c.subarray())
        );
      });
    }
  }
});
