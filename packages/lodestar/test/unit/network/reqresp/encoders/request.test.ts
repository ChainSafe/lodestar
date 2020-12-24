import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  Ping,
  RequestBody,
  Status,
} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding} from "../../../../../src/constants";
import {createStatus, generateRoots} from "./utils";
import {requestEncode} from "../../../../../src/network/reqresp/encoders/requestEncode";
import {requestDecode} from "../../../../../src/network/reqresp/encoders/requestDecode";
import {SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy/errors";

chai.use(chaiAsPromised);

describe("network reqresp encode decode - success", () => {
  interface IRequestTypes {
    [Method.Status]: Status;
    [Method.Goodbye]: Goodbye;
    [Method.Ping]: Ping;
    [Method.Metadata]: null;
    [Method.BeaconBlocksByRange]: BeaconBlocksByRangeRequest;
    [Method.BeaconBlocksByRoot]: BeaconBlocksByRootRequest;
  }

  const testCases: {[P in keyof IRequestTypes]: IRequestTypes[P][]} = {
    [Method.Status]: [createStatus()],
    [Method.Goodbye]: [BigInt(0), BigInt(1)],
    [Method.Ping]: [BigInt(0), BigInt(1)],
    [Method.Metadata]: [],
    [Method.BeaconBlocksByRange]: [{startSlot: 10, count: 20, step: 1}],
    [Method.BeaconBlocksByRoot]: [generateRoots(4, 0xda)],
  };

  const encodings: ReqRespEncoding[] = [ReqRespEncoding.SSZ_SNAPPY];

  for (const encoding of encodings) {
    for (const [_method, requests] of Object.entries(testCases)) {
      let i = 0;
      const method = _method as keyof typeof testCases;
      for (const request of requests) {
        it(`${encoding} ${method} - req ${i++}`, async () => {
          const returnedRequest = await pipe(
            [request],
            requestEncode(config, method, encoding),
            requestDecode(config, method, encoding)
          );

          const type = Methods[method].requestSSZType(config);
          if (!type) throw Error("no type");

          expect(type.equals(returnedRequest, request as any)).to.equal(
            true,
            "decoded request does not match encoded request"
          );
        });
      }
    }
  }
});

describe("network reqresp encode - errors", () => {
  const testCases: {
    id: string;
    method: Method;
    encoding: ReqRespEncoding;
    error: string;
    request: RequestBody;
  }[] = [
    {
      id: "Bad body",
      method: Method.Status,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      error: SszSnappyErrorCode.SERIALIZE_ERROR,
      request: BigInt(1),
    },
    // "No body" is ok since requestEncode checks for null,
    // and if the request source is empty it will just yield no chunks
  ];

  for (const {id, method, encoding, error, request} of testCases) {
    it(id, async () => {
      await expect(pipe([request], requestEncode(config, method, encoding), all)).to.be.rejectedWith(error);
    });
  }
});

describe("network reqresp decode - errors", () => {
  const testCases: {
    id: string;
    method: Method;
    encoding: ReqRespEncoding;
    error: string;
    chunks: Buffer[];
  }[] = [
    {
      id: "Bad body",
      method: Method.Status,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      error: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE,
      chunks: [Buffer.from("4")],
    },
    {
      id: "No body",
      method: Method.Status,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      error: SszSnappyErrorCode.SOURCE_ABORTED,
      chunks: [],
    },
  ];

  for (const {id, method, encoding, error, chunks} of testCases) {
    it(id, async () => {
      // it-pipe does not convert the chunks array to a generator
      async function* chunkSource(): AsyncGenerator<Buffer> {
        for (const chunk of chunks) {
          yield chunk;
        }
      }

      await expect(pipe(chunkSource(), requestDecode(config, method, encoding))).to.be.rejectedWith(error);
    });
  }
});
