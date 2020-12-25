import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import all from "it-all";
import varint from "varint";
import {config} from "@chainsafe/lodestar-config/minimal";
import {LodestarError} from "@chainsafe/lodestar-utils";
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
import {arrToSource, createStatus, isEqualSszType} from "../utils";

chai.use(chaiAsPromised);

describe("network reqresp response - encode decode success", () => {
  interface IResponseTypes {
    [Method.Status]: Status;
    [Method.Goodbye]: Goodbye;
    [Method.Ping]: Ping;
    [Method.Metadata]: Metadata;
    [Method.BeaconBlocksByRange]: SignedBeaconBlock;
    [Method.BeaconBlocksByRoot]: SignedBeaconBlock;
  }

  const testCases: {[P in keyof IResponseTypes]: IResponseTypes[P][][]} = {
    [Method.Status]: [[createStatus()]],
    [Method.Goodbye]: [[BigInt(0)], [BigInt(1)]],
    [Method.Ping]: [[BigInt(0)], [BigInt(1)]],
    [Method.Metadata]: [],
    [Method.BeaconBlocksByRange]: [generateEmptySignedBlocks(10)],
    [Method.BeaconBlocksByRoot]: [generateEmptySignedBlocks(10)],
  };

  const encodings: ReqRespEncoding[] = [ReqRespEncoding.SSZ_SNAPPY];

  for (const encoding of encodings) {
    for (const [_method, responsesChunks] of Object.entries(testCases)) {
      let i = 0;
      const method = _method as keyof typeof testCases;
      for (const responseChunks of responsesChunks) {
        it(`${encoding} ${method} - resp ${i++}`, async () => {
          const returnedResponses = await pipe(
            responseChunks as ResponseBody[],
            responseEncodeSuccess(config, method, encoding),
            responseDecode(config, method, encoding),
            all
          );

          const type = Methods[method].responseSSZType(config);
          if (!type) throw Error("no type");

          returnedResponses.forEach((returnedResponse, i) => {
            expect(isEqualSszType(type, returnedResponse, responseChunks[i])).to.equal(
              true,
              "decoded response does not match encoded response"
            );
          });
        });
      }
    }
  }
});

describe.only("network reqresp response - encode errors", () => {
  const testCases: {
    id: string;
    method?: Method;
    encoding?: ReqRespEncoding;
    error: string;
    responseChunks: IResponseChunk[];
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
      error: "SOME_ERROR",
      responseChunks: [{status: RpcResponseStatus.INVALID_REQUEST, errorMessage: ""}],
    },
    {
      id: "Single chunk with SERVER_ERROR",
      error: "SOME_ERROR",
      responseChunks: [{status: RpcResponseStatus.SERVER_ERROR, errorMessage: ""}],
    },
    {
      id: "Multiple chunks with final error",
      method: Method.Status,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      error: "SOME_ERROR",
      responseChunks: [
        ...generateEmptySignedBlocks(3).map((body) => ({status: RpcResponseStatus.SUCCESS as const, body})),
        {status: RpcResponseStatus.SERVER_ERROR, errorMessage: "Error on block #4"},
        ...generateEmptySignedBlocks(6).map((body) => ({status: RpcResponseStatus.SUCCESS as const, body})),
      ],
    },
  ];

  for (const {id, method = Method.Status, encoding = ReqRespEncoding.SSZ_SNAPPY, error, responseChunks} of testCases) {
    it(id, async () => {
      await expect(pipe(responseChunks, responseEncode(config, method, encoding), all)).to.be.rejectedWith(error);
    });
  }
});

describe("network reqresp response - decode error", () => {
  const metadata = {
    method: Method.Status,
    encoding: ReqRespEncoding.SSZ_SNAPPY,
  };

  const testCases: {
    id: string;
    chunks: Buffer[];
    error: ResponseError;
  }[] = [
    {
      id: "No chunks",
      chunks: [],
      error: new ResponseError({
        code: ResponseErrorCode.OTHER_ERROR,
        error: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
        ...metadata,
      }),
    },
    {
      id: "Empty payload",
      chunks: [Buffer.from([RpcResponseStatus.SUCCESS])],
      error: new ResponseError({
        code: ResponseErrorCode.OTHER_ERROR,
        error: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
        ...metadata,
      }),
    },
    {
      id: "Regular error INVALID_REQUEST",
      chunks: [Buffer.from([RpcResponseStatus.INVALID_REQUEST]), Buffer.from("TEST_ERROR")],
      error: new ResponseError({
        code: ResponseErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR",
        ...metadata,
      }),
    },
    {
      id: "Regular error SERVER_ERROR",
      chunks: [Buffer.from([RpcResponseStatus.SERVER_ERROR]), Buffer.from("TEST_ERROR")],
      error: new ResponseError({
        code: ResponseErrorCode.SERVER_ERROR,
        errorMessage: "TEST_ERROR",
        ...metadata,
      }),
    },
    {
      id: "Slice long error message",
      chunks: [Buffer.from([RpcResponseStatus.INVALID_REQUEST]), Buffer.from("TEST_ERROR".repeat(1000))],
      error: new ResponseError({
        code: ResponseErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR".repeat(1000).slice(0, 256),
        ...metadata,
      }),
    },
    {
      id: "Remove non-ascii characters from error message",
      chunks: [Buffer.from([RpcResponseStatus.INVALID_REQUEST]), Buffer.from("TEST_ERROR\u03A9")],
      error: new ResponseError({
        code: ResponseErrorCode.INVALID_REQUEST,
        errorMessage: "TEST_ERROR",
        ...metadata,
      }),
    },
  ];

  for (const {id, error, chunks} of testCases) {
    it(id, async () => {
      try {
        await pipe(arrToSource(chunks), responseDecode(config, metadata.method, metadata.encoding), all);
        throw Error("did not throw");
      } catch (e) {
        expectLodestarError(e, error);
      }
    });
  }
});

function expectLodestarError<T extends {code: string}>(err1: LodestarError<T>, err2: LodestarError<T>): void {
  if (!(err1 instanceof LodestarError)) throw Error(`err1 not instanceof LodestarError: ${(err1 as Error).stack}`);
  if (!(err2 instanceof LodestarError)) throw Error(`err2 not instanceof LodestarError: ${(err2 as Error).stack}`);

  expect(err1.getMetadata()).to.deep.equal(err2.getMetadata(), "Wrong LodestarError metadata");
}

function generateEmptySignedBlocks(n = 3): SignedBeaconBlock[] {
  return Array.from({length: n}).map(() => generateEmptySignedBlock());
}
