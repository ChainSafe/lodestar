import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {RequestBody} from "@chainsafe/lodestar-types";
import {Method, ReqRespEncoding} from "../../../../../src/constants";
import {SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {requestEncode} from "../../../../../src/network/reqresp/request/requestEncode";
import {requestDecode} from "../../../../../src/network/reqresp/response/requestDecode";
import {arrToSource} from "../utils";

chai.use(chaiAsPromised);

describe("network reqresp request - encode errors", () => {
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
      await expect(pipe(requestEncode(config, method, encoding, request), all)).to.be.rejectedWith(error);
    });
  }
});

describe("network reqresp request - decode errors", () => {
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
      await expect(pipe(arrToSource(chunks), requestDecode(config, method, encoding))).to.be.rejectedWith(error);
    });
  }
});
