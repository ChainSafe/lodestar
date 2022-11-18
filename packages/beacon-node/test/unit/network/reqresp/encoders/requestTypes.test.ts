import {expect} from "chai";
import {pipe} from "it-pipe";
import {phase0} from "@lodestar/types";
import {
  ReqRespMethod,
  Encoding,
  getRequestSzzTypeByMethod,
  RequestBody,
} from "../../../../../src/network/reqresp/types.js";
import {requestEncode} from "../../../../../src/network/reqresp/encoders/requestEncode.js";
import {requestDecode} from "../../../../../src/network/reqresp/encoders/requestDecode.js";
import {isEqualSszType} from "../../../../utils/ssz.js";
import {createStatus, generateRoots} from "../utils.js";

// Ensure the types from all methods are supported properly
describe("network / reqresp / encoders / request - types", () => {
  interface IRequestTypes {
    [ReqRespMethod.Status]: phase0.Status;
    [ReqRespMethod.Goodbye]: phase0.Goodbye;
    [ReqRespMethod.Ping]: phase0.Ping;
    [ReqRespMethod.Metadata]: null;
    [ReqRespMethod.BeaconBlocksByRange]: phase0.BeaconBlocksByRangeRequest;
    [ReqRespMethod.BeaconBlocksByRoot]: phase0.BeaconBlocksByRootRequest;
  }

  const testCases: {[P in keyof IRequestTypes]: IRequestTypes[P][]} = {
    [ReqRespMethod.Status]: [createStatus()],
    [ReqRespMethod.Goodbye]: [BigInt(0), BigInt(1)],
    [ReqRespMethod.Ping]: [BigInt(0), BigInt(1)],
    [ReqRespMethod.Metadata]: [],
    [ReqRespMethod.BeaconBlocksByRange]: [{startSlot: 10, count: 20, step: 1}],
    [ReqRespMethod.BeaconBlocksByRoot]: [generateRoots(4, 0xda)],
  };

  const encodings: Encoding[] = [Encoding.SSZ_SNAPPY];

  for (const encoding of encodings) {
    for (const [_method, _requests] of Object.entries(testCases)) {
      // Cast to more generic types, type by index is useful only at declaration of `testCases`
      const method = _method as keyof typeof testCases;
      const requests = _requests as RequestBody[];

      for (const [i, request] of requests.entries()) {
        it(`${encoding} ${method} - req ${i}`, async () => {
          const returnedRequest = await pipe(
            requestEncode({method, encoding}, request),
            requestDecode({method, encoding})
          );

          const type = getRequestSzzTypeByMethod(method);
          if (!type) throw Error("no type");

          expect(isEqualSszType(type, returnedRequest, request)).to.equal(
            true,
            "decoded request does not match encoded request"
          );
        });
      }
    }
  }
});
