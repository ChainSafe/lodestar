import {expect} from "chai";
import all from "it-all";
import pipe from "it-pipe";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/minimal";
import {RequestBody} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding} from "../../../../../src/constants";
import {requestEncode} from "../../../../../src/network/reqresp/request/requestEncode";
import {expectLodestarError} from "../utils";
import {SszSnappyError, SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy";

describe("network / reqresp / response / requestEncode", () => {
  const testCases: {
    id: string;
    method: Method;
    encoding: ReqRespEncoding;
    requestBody: RequestBody;
    error?: LodestarError<any>;
    chunks?: string[];
  }[] = [
    {
      id: "No body",
      method: Method.Metadata,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      requestBody: null,
      chunks: [],
    },
    {
      id: "Bad body",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      requestBody: {startSlot: 0, step: 0, headSlot: 0, count: 0},
      error: new SszSnappyError({
        code: SszSnappyErrorCode.SERIALIZE_ERROR,
        serializeError: new TypeError("Cannot mix BigInt and other types, use explicit conversions"),
      }),
    },
    {
      id: "Regular request",
      method: Method.Ping,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      requestBody: BigInt(1),
      chunks: [
        "0x08", // length prefix
        "0xff060000734e61507059", // snappy frames header
        "0x010c00000175de410100000000000000", // snappy frames content
      ],
    },
  ];

  for (const {id, method, encoding, requestBody, error, chunks} of testCases) {
    it(id, async () => {
      const resultPromise = pipe(requestEncode(config, method, encoding, requestBody), all);

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
