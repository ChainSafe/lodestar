import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/minimal";
import {Method, ReqRespEncoding} from "../../../../../src/constants";
import {SszSnappyErrorCode} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {requestDecode} from "../../../../../src/network/reqresp/encoders/requestDecode";
import {arrToSource} from "../utils";

chai.use(chaiAsPromised);

describe("network / reqresp / encoders / requestDecode", () => {
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
      id: "No body, should be ok",
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
