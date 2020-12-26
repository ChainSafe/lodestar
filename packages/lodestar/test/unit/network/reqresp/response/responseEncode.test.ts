import {expect} from "chai";
import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding, RpcResponseStatus, RpcResponseStatusError} from "../../../../../src/constants";
import {responseEncodeError, responseEncodeSuccess} from "../../../../../src/network/reqresp/response/responseEncode";
import {SszSnappyError, SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {expectLodestarError} from "../utils";

describe("network / reqresp / response / responseEncode", () => {
  describe("responseEncodeSuccess", () => {
    const testCases: {
      id: string;
      method: Method;
      encoding: ReqRespEncoding;
      responseChunks: ResponseBody[];
      error?: LodestarError<any>;
      chunks?: string[];
    }[] = [
      {
        id: "Zero chunks",
        method: Method.Status,
        encoding: ReqRespEncoding.SSZ_SNAPPY,
        responseChunks: [],
        chunks: [],
      },
      {
        id: "Bad body",
        method: Method.Status,
        encoding: ReqRespEncoding.SSZ_SNAPPY,
        responseChunks: [BigInt(1)],
        error: new SszSnappyError({
          code: SszSnappyErrorCode.SERIALIZE_ERROR,
          serializeError: new TypeError("Cannot convert undefined or null to object"),
        }),
      },
      {
        id: "Multiple chunks",
        method: Method.Ping,
        encoding: ReqRespEncoding.SSZ_SNAPPY,
        responseChunks: [BigInt(1), BigInt(1)],
        chunks: [
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
        ],
      },
    ];

    for (const {id, method, encoding, responseChunks, error, chunks} of testCases) {
      it(id, async () => {
        const resultPromise = pipe(responseChunks, responseEncodeSuccess(config, method, encoding), all);

        if (chunks) {
          const encodedChunks = await resultPromise;
          expect(encodedChunks.map(toHexString)).to.deep.equal(chunks);
        } else if (error) {
          try {
            await resultPromise;
            throw Error("did not throw");
          } catch (e) {
            expectLodestarError(e, error);
          }
        } else {
          throw Error("Bad error data");
        }
      });
    }
  });

  describe("responseEncodeError", () => {
    const testCases: {
      id: string;
      status: RpcResponseStatusError;
      errorMessage: string;
      chunks: string[];
    }[] = [
      {
        id: "INVALID_REQUEST no error message",
        status: RpcResponseStatus.INVALID_REQUEST,
        errorMessage: "",
        chunks: ["0x01"],
      },
      {
        id: "SERVER_ERROR no error message",
        status: RpcResponseStatus.SERVER_ERROR,
        errorMessage: "",
        chunks: ["0x02"],
      },
      {
        id: "INVALID_REQUEST with error message",
        status: RpcResponseStatus.SERVER_ERROR,
        errorMessage: "SOME_ERROR",
        chunks: ["0x02", "0x534f4d455f4552524f52"],
      },
    ];

    for (const {id, status, errorMessage, chunks} of testCases) {
      it(id, async () => {
        const encodedChunks = await pipe(responseEncodeError(status, errorMessage), all);
        expect(encodedChunks.map(toHexString)).to.deep.equal(chunks);
      });
    }
  });
});
