import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {Goodbye, Metadata, Ping, ResponseBody, SignedBeaconBlock, Status} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus} from "../../../../../src/constants";
import {
  responseDecode,
  ResponseError,
  ResponseErrorCode,
} from "../../../../../src/network/reqresp/encoders/responseDecode";
import {IResponseChunk} from "../../../../../src/network";
import {
  SszSnappyError,
  SszSnappyErrorCode,
} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy/errors";
import {responseEncode, responseEncodeSuccess} from "../../../../../src/network/reqresp/encoders/responseEncode";
import {generateEmptySignedBlock} from "../../../../utils/block";
import {arrToSource, createStatus, expectLodestarError, isEqualSszType} from "../utils";

chai.use(chaiAsPromised);

describe.only("network reqresp response - encode from raw chunks", () => {
  const defaultMetadata = {
    method: Method.Status,
    encoding: ReqRespEncoding.SSZ_SNAPPY,
  };

  const testCases: {
    id: string;
    method?: Method;
    encoding?: ReqRespEncoding;
    error?: ResponseError;
    responsesBody?: ResponseBody[];
    responseChunks: IResponseChunk[];
    chunks: string[];
  }[] = [
    // {
    //   id: "Bad body",
    //   method: Method.Status,
    //   encoding: ReqRespEncoding.SSZ_SNAPPY,
    //   error: SszSnappyErrorCode.SERIALIZE_ERROR,
    //   response: BigInt(1),
    // },
    // {
    //   id: "should work - no response - ssz",
    //   method: Method.Status,
    //   encoding: ReqRespEncoding.SSZ_SNAPPY,
    //   error: null,
    //   response: [],
    // },
    {
      id: "Single chunk with INVALID_REQUEST",
      responseChunks: [{status: RpcResponseStatus.INVALID_REQUEST, errorMessage: ""}],
      error: new ResponseError({code: ResponseErrorCode.INVALID_REQUEST, errorMessage: "", ...defaultMetadata}),
      chunks: ["0x01"],
    },

    {
      id: "Single chunk with SERVER_ERROR",
      responseChunks: [{status: RpcResponseStatus.SERVER_ERROR, errorMessage: ""}],
      error: new ResponseError({code: ResponseErrorCode.SERVER_ERROR, errorMessage: "", ...defaultMetadata}),
      chunks: ["0x02"],
    },

    {
      id: "Multiple chunks with final error",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      responseChunks: [
        {status: RpcResponseStatus.SUCCESS, body: BigInt(1)},
        {status: RpcResponseStatus.SUCCESS, body: BigInt(1)},
        {status: RpcResponseStatus.SERVER_ERROR, errorMessage: ""},
        {status: RpcResponseStatus.SUCCESS, body: BigInt(1)},
      ],
      error: new ResponseError({
        code: ResponseErrorCode.SERVER_ERROR,
        errorMessage: "",
        method: Method.Ping,
        encoding: ReqRespEncoding.SSZ_SNAPPY,
      }),
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
        // Chunk 2 - error
        "0x02",
        // Chunks > 2 ignored after error
      ],
    },

    {
      id: "Multiple chunks with success",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      responseChunks: [
        {status: RpcResponseStatus.SUCCESS, body: BigInt(1)},
        {status: RpcResponseStatus.SUCCESS, body: BigInt(1)},
      ],
      responsesBody: [BigInt(1), BigInt(1)],
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

  for (const {
    id,
    method = defaultMetadata.method,
    encoding = defaultMetadata.encoding,
    error,
    responseChunks,
    responsesBody,
    chunks,
  } of testCases) {
    it(`${id} - encode`, async () => {
      const encodedChunks = await pipe(responseChunks, responseEncode(config, method, encoding), all);
      expect(encodedChunks.map(toHexString)).to.deep.equal(chunks);
    });

    const runResponseDecode = (): Promise<ResponseBody[]> =>
      pipe(
        arrToSource(chunks.map((chunk) => Buffer.from(fromHexString(chunk)))),
        responseDecode(config, method, encoding),
        all
      );

    if (error) {
      it(`${id} - decode error`, async () => {
        try {
          await runResponseDecode();
          throw Error("did not throw");
        } catch (e) {
          expectLodestarError(e, error);
        }
      });
    }

    if (responsesBody) {
      it(`${id} - decode success`, async () => {
        const type = Methods[method].responseSSZType(config);
        if (!type) throw Error("no type");

        const responses = await runResponseDecode();

        responses.forEach((response, i) => {
          const expectedResponse = responsesBody[i];
          if (expectedResponse === undefined) throw Error(`No expectedResponse at index ${i}`);
          expect(isEqualSszType(type, response, expectedResponse)).to.equal(
            true,
            "decoded response does not match encoded response"
          );
        });
      });
    }
  }
});

describe("network reqresp response - decode error", () => {
  const metadata = {
    method: Method.Status,
    encoding: ReqRespEncoding.SSZ_SNAPPY,
  };

  interface ITestCaseDataCommon {
    id: string;
    method?: Method;
    encoding?: ReqRespEncoding;
    chunks: string[];
  }

  interface ITestCaseDataError extends ITestCaseDataCommon {
    isError: true;
    error: ResponseError;
  }

  interface ITestCaseDataOk extends ITestCaseDataCommon {
    isError: false;
    responseChunks: ResponseBody[];
  }

  type ITestCaseData = ITestCaseDataError | ITestCaseDataOk;

  const testCases: ITestCaseData[] = [
    {
      id: "No chunks",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      isError: false,
      responseChunks: [],
      chunks: [],
    },
    {
      id: "Multiple chunks with final error",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      isError: false,
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
        // Chunk 2 - error
        // "0x02",
        // Chunks > 2 ignored after error
      ],
    },
    {
      id: "Each chunk data is concated",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      isError: false,
      responseChunks: [BigInt(1), BigInt(1)],
      chunks: [
        // success, Ping payload = BigInt(1)
        "0x0008ff060000734e61507059010c00000175de410100000000000000",
        "0x0008ff060000734e61507059010c00000175de410100000000000000",
      ],
    },

    {
      id: "Empty payload",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      isError: true,
      error: new ResponseError({
        code: ResponseErrorCode.OTHER_ERROR,
        error: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
        ...metadata,
      }),
      chunks: ["0x00"],
    },

    // Errored requests
    {
      id: "Regular error INVALID_REQUEST",
      isError: true,
      error: new ResponseError({
        code: ResponseErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR",
        ...metadata,
      }),
      chunks: ["0x01", toHexString(Buffer.from("TEST_ERROR"))],
    },
    {
      id: "Regular error SERVER_ERROR",
      isError: true,
      error: new ResponseError({
        code: ResponseErrorCode.SERVER_ERROR,
        errorMessage: "TEST_ERROR",
        ...metadata,
      }),
      chunks: ["0x02", toHexString(Buffer.from("TEST_ERROR"))],
    },
    {
      id: "Slice long error message",
      isError: true,
      error: new ResponseError({
        code: ResponseErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR".repeat(1000).slice(0, 256),
        ...metadata,
      }),
      chunks: ["0x01", toHexString(Buffer.from("TEST_ERROR".repeat(1000)))],
    },
    {
      id: "Remove non-ascii characters from error message",
      isError: true,
      error: new ResponseError({
        code: ResponseErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR",
        ...metadata,
      }),
      chunks: ["0x01", toHexString(Buffer.from("TEST_ERROR\u03A9"))],
    },
  ];

  for (const testData of testCases) {
    const {id, method = metadata.method, encoding = metadata.encoding, chunks} = testData;
    it(id, async () => {
      const responseDecodePromise = pipe(
        arrToSource(chunks.map((chunk) => Buffer.from(fromHexString(chunk)))),
        responseDecode(config, method, encoding),
        all
      );

      if (testData.isError) {
        try {
          await responseDecodePromise;
          throw Error("did not throw");
        } catch (e) {
          expectLodestarError(e, testData.error);
        }
      } else {
        const type = Methods[method].responseSSZType(config);
        if (!type) throw Error("no type");

        const responses = await responseDecodePromise;

        responses.forEach((response, i) => {
          const expectedResponse = testData.responseChunks[i];
          if (expectedResponse === undefined) throw Error(`No expectedResponse at index ${i}`);
          expect(isEqualSszType(type, response, expectedResponse)).to.equal(
            true,
            "decoded response does not match encoded response"
          );
        });
      }
    });
  }
});
