import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/minimal";
import {
  BeaconBlocksByRangeRequest,
  BeaconBlocksByRootRequest,
  Goodbye,
  Ping,
  RequestBody,
  Status,
} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding} from "../../../../src/constants";
import {requestEncode} from "../../../../src/network/reqresp/request/requestEncode";
import {requestDecode} from "../../../../src/network/reqresp/response/requestDecode";
import {isEqualSszType} from "../../../utils/ssz";
import {createStatus, generateRoots} from "./utils";

chai.use(chaiAsPromised);

describe("network / reqresp / encode decode / request body", () => {
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
    for (const [_method, _requests] of Object.entries(testCases)) {
      // Cast to more generic types, type by index is useful only at declaration of `testCases`
      const method = _method as keyof typeof testCases;
      const requests = _requests as RequestBody[];

      requests.forEach((request, i) => {
        it(`${encoding} ${method} - req ${i}`, async () => {
          const returnedRequest = await pipe(
            requestEncode(config, method, encoding, request),
            requestDecode(config, method, encoding)
          );

          const type = Methods[method].requestSSZType(config);
          if (!type) throw Error("no type");

          expect(isEqualSszType(type, returnedRequest, request)).to.equal(
            true,
            "decoded request does not match encoded request"
          );
        });
      });
    }
  }
});
