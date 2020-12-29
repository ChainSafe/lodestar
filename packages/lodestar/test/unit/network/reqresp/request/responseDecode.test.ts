import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding, RESP_TIMEOUT} from "../../../../../src/constants";
import {SszSnappyError, SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {responseDecode} from "../../../../../src/network/reqresp/request/responseDecode";
import {RequestErrorCode, RequestInternalError} from "../../../../../src/network/reqresp/request/errors";
import {arrToSource, expectLodestarError, isEqualSszType} from "../utils";

chai.use(chaiAsPromised);

describe("network / reqresp / request / responseDecode", () => {
  const metadata = {
    method: Method.Status,
    encoding: ReqRespEncoding.SSZ_SNAPPY,
  };

  enum TestResult {
    ERROR = "ERROR",
    SUCCESS = "SUCCESS",
  }

  type ITestCaseData = {id: string; method?: Method; encoding?: ReqRespEncoding; chunks: string[]} & (
    | {testResult: TestResult.ERROR; error: LodestarError<any>}
    | {testResult: TestResult.SUCCESS; responseChunks: ResponseBody[]}
  );

  const testCases: ITestCaseData[] = [
    {
      id: "No chunks",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      testResult: TestResult.SUCCESS,
      responseChunks: [],
      chunks: [],
    },
    {
      id: "Multiple chunks with success",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      testResult: TestResult.SUCCESS,
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
    {
      id: "Multiple chunks with final error",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      testResult: TestResult.ERROR,
      error: new RequestInternalError({
        code: RequestErrorCode.SERVER_ERROR,
        errorMessage: "",
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
      ],
    },
    {
      id: "Each chunk data is concated",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      testResult: TestResult.SUCCESS,
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
      testResult: TestResult.ERROR,
      error: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
      chunks: ["0x00"],
    },

    // Errored requests
    {
      id: "Single chunk with INVALID_REQUEST",
      testResult: TestResult.ERROR,
      error: new RequestInternalError({
        code: RequestErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR",
      }),
      chunks: ["0x01", toHexString(Buffer.from("TEST_ERROR"))],
    },
    {
      id: "Single chunk with SERVER_ERROR",
      testResult: TestResult.ERROR,
      error: new RequestInternalError({
        code: RequestErrorCode.SERVER_ERROR,
        errorMessage: "TEST_ERROR",
      }),
      chunks: ["0x02", toHexString(Buffer.from("TEST_ERROR"))],
    },
    {
      id: "Slice long error message",
      testResult: TestResult.ERROR,
      error: new RequestInternalError({
        code: RequestErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR".repeat(1000).slice(0, 256),
      }),
      chunks: ["0x01", toHexString(Buffer.from("TEST_ERROR".repeat(1000)))],
    },
    {
      id: "Remove non-ascii characters from error message",
      testResult: TestResult.ERROR,
      error: new RequestInternalError({
        code: RequestErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR",
      }),
      chunks: ["0x01", toHexString(Buffer.from("TEST_ERROR\u03A9"))],
    },
  ];

  for (const testData of testCases) {
    const {id, method = metadata.method, encoding = metadata.encoding, chunks} = testData;
    it(id, async () => {
      const responseDecodePromise = pipe(
        arrToSource(chunks.map((chunk) => Buffer.from(fromHexString(chunk)))),
        responseDecode(config, method, encoding, RESP_TIMEOUT),
        all
      );

      switch (testData.testResult) {
        case TestResult.ERROR: {
          try {
            await responseDecodePromise;
            throw Error("did not throw");
          } catch (e) {
            expectLodestarError(e, testData.error);
          }
          break;
        }

        case TestResult.SUCCESS: {
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
          break;
        }

        default:
          throw Error("Unknown test type");
      }
    });
  }
});
