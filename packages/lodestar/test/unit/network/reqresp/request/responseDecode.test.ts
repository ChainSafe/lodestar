import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {fromHexString} from "@chainsafe/ssz";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus} from "../../../../../src/constants";
import {SszSnappyError, SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {responseDecode} from "../../../../../src/network/reqresp/request/responseDecode";
import {RequestErrorCode, RequestInternalError} from "../../../../../src/network/reqresp/request/errors";
import {expectIsEqualSszTypeArr} from "../../../../utils/ssz";
import {expectRejectedWithLodestarError} from "../../../../utils/errors";
import {arrToSource} from "../utils";
import {sszSnappyPing} from "../encodingStrategies/sszSnappy/testData";

chai.use(chaiAsPromised);

// Ping, SSZ_SNAPPY
const samplePayload = {
  payload: sszSnappyPing.body,
  chunks: sszSnappyPing.chunks.map(fromHexString) as Buffer[],
};

describe("network / reqresp / request / responseDecode", () => {
  const methodDefault = Method.Status;
  const encodingDefault = ReqRespEncoding.SSZ_SNAPPY;

  const testCases: {
    id: string;
    method?: Method;
    encoding?: ReqRespEncoding;
    chunks: Buffer[];
    error?: LodestarError<any>;
    responseChunks?: ResponseBody[];
  }[] = [
    {
      id: "No chunks",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      responseChunks: [],
      chunks: [],
    },
    {
      id: "Multiple chunks with success",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      responseChunks: [samplePayload.payload, samplePayload.payload],
      chunks: [
        // Chunk 0 - success
        Buffer.from([RpcResponseStatus.SUCCESS]),
        ...samplePayload.chunks,
        // Chunk 1 - success
        Buffer.from([RpcResponseStatus.SUCCESS]),
        ...samplePayload.chunks,
      ],
    },
    {
      id: "Multiple chunks with final error",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      error: new RequestInternalError({
        code: RequestErrorCode.SERVER_ERROR,
        errorMessage: "",
      }),
      chunks: [
        // Chunk 0 - success
        Buffer.from([RpcResponseStatus.SUCCESS]),
        ...samplePayload.chunks,
        // Chunk 1 - success
        Buffer.from([RpcResponseStatus.SUCCESS]),
        ...samplePayload.chunks,
        // Chunk 2 - error
        Buffer.from([RpcResponseStatus.SERVER_ERROR]),
      ],
    },
    {
      id: "Each chunk data is concated",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      responseChunks: [BigInt(1), BigInt(1)],
      chunks: [
        // success, Ping payload = BigInt(1)
        Buffer.concat([Buffer.from([RpcResponseStatus.SUCCESS]), ...samplePayload.chunks]),
        Buffer.concat([Buffer.from([RpcResponseStatus.SUCCESS]), ...samplePayload.chunks]),
      ],
    },

    {
      id: "Empty payload",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      error: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
      chunks: [Buffer.from([RpcResponseStatus.SUCCESS])],
    },

    // Errored requests
    {
      id: "Single chunk with INVALID_REQUEST",
      error: new RequestInternalError({
        code: RequestErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR",
      }),
      chunks: [Buffer.from([RpcResponseStatus.INVALID_REQUEST]), Buffer.from("TEST_ERROR")],
    },
    {
      id: "Single chunk with SERVER_ERROR",
      error: new RequestInternalError({
        code: RequestErrorCode.SERVER_ERROR,
        errorMessage: "TEST_ERROR",
      }),
      chunks: [Buffer.from([RpcResponseStatus.SERVER_ERROR]), Buffer.from("TEST_ERROR")],
    },
    {
      id: "Slice long error message",
      error: new RequestInternalError({
        code: RequestErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR".repeat(1000).slice(0, 256),
      }),
      chunks: [Buffer.from([RpcResponseStatus.INVALID_REQUEST]), Buffer.from("TEST_ERROR".repeat(1000))],
    },
    {
      id: "Remove non-ascii characters from error message",
      error: new RequestInternalError({
        code: RequestErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR",
      }),
      chunks: [Buffer.from([RpcResponseStatus.INVALID_REQUEST]), Buffer.from("TEST_ERROR\u03A9")],
    },
  ];

  for (const testData of testCases) {
    const {id, method = methodDefault, encoding = encodingDefault, chunks} = testData;
    it(id, async () => {
      const responseDecodePromise = pipe(arrToSource(chunks), responseDecode(config, method, encoding), all);

      if (testData.responseChunks) {
        const responses = await responseDecodePromise;
        const type = Methods[method].responseSSZType(config);
        expectIsEqualSszTypeArr(type, responses, testData.responseChunks, "Response chunks");
      } else if (testData.error) {
        await expectRejectedWithLodestarError(responseDecodePromise, testData.error);
      } else {
        throw Error("Bad testCase");
      }
    });
  }
});
