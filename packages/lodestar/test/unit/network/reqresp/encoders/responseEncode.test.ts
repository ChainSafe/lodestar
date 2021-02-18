import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding, RpcResponseStatus, RpcResponseStatusError} from "../../../../../src/constants";
import {responseEncodeError, responseEncodeSuccess} from "../../../../../src/network/reqresp/encoders/responseEncode";
import {SszSnappyError, SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {expectRejectedWithLodestarError} from "../../../../utils/errors";
import {sszSnappyPing} from "../encodingStrategies/sszSnappy/testData";
import {expectEqualByteChunks} from "../utils";

describe("network / reqresp / encoders / responseEncode", () => {
  describe("responseEncodeSuccess", () => {
    const testCases: {
      id: string;
      method: Method;
      encoding: ReqRespEncoding;
      responseChunks: phase0.ResponseBody[];
      error?: LodestarError<any>;
      chunks?: Buffer[];
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
        responseChunks: [sszSnappyPing.body, sszSnappyPing.body],
        chunks: [
          // Chunk 0 - success
          Buffer.from([RpcResponseStatus.SUCCESS]),
          ...sszSnappyPing.chunks,
          // Chunk 1 - success
          Buffer.from([RpcResponseStatus.SUCCESS]),
          ...sszSnappyPing.chunks,
        ],
      },
    ];

    for (const {id, method, encoding, responseChunks, error, chunks} of testCases) {
      it(id, async () => {
        const resultPromise = pipe(responseChunks, responseEncodeSuccess(config, method, encoding), all);

        if (chunks) {
          const encodedChunks = await resultPromise;
          expectEqualByteChunks(encodedChunks, chunks);
        } else if (error) {
          await expectRejectedWithLodestarError(resultPromise, error);
        } else {
          throw Error("Bad testCase");
        }
      });
    }
  });

  describe("responseEncodeError", () => {
    const testCases: {
      id: string;
      status: RpcResponseStatusError;
      errorMessage: string;
      chunks: Buffer[];
    }[] = [
      {
        id: "INVALID_REQUEST no error message",
        status: RpcResponseStatus.INVALID_REQUEST,
        errorMessage: "",
        chunks: [Buffer.from([RpcResponseStatus.INVALID_REQUEST])],
      },
      {
        id: "SERVER_ERROR no error message",
        status: RpcResponseStatus.SERVER_ERROR,
        errorMessage: "",
        chunks: [Buffer.from([RpcResponseStatus.SERVER_ERROR])],
      },
      {
        id: "INVALID_REQUEST with error message",
        status: RpcResponseStatus.SERVER_ERROR,
        errorMessage: "TEST_ERROR",
        chunks: [Buffer.from([RpcResponseStatus.SERVER_ERROR]), Buffer.from("TEST_ERROR")],
      },
    ];

    for (const {id, status, errorMessage, chunks} of testCases) {
      it(id, async () => {
        const encodedChunks = await pipe(responseEncodeError(status, errorMessage), all);
        expectEqualByteChunks(encodedChunks, chunks);
      });
    }
  });
});
