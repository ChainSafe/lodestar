import {expect} from "chai";
import {pipe} from "it-pipe";
import {phase0} from "@lodestar/types";
import {Method, Encoding, getRequestSzzTypeByMethod, RequestBody} from "../../../../../src/network/reqresp/types.js";
import {requestEncode} from "../../../../../src/network/reqresp/encoders/requestEncode.js";
import {requestDecode} from "../../../../../src/network/reqresp/encoders/requestDecode.js";
import {isEqualSszType} from "../../../../utils/ssz.js";
import {createStatus, generateRoots} from "../utils.js";

// Ensure the types from all methods are supported properly
describe("network / reqresp / encoders / request - types", () => {
  interface IRequestTypes {
    [Method.Status]: phase0.Status;
    [Method.Goodbye]: phase0.Goodbye;
    [Method.Ping]: phase0.Ping;
    [Method.Metadata]: null;
    [Method.BeaconBlocksByRange]: phase0.BeaconBlocksByRangeRequest;
    [Method.BeaconBlocksByRoot]: phase0.BeaconBlocksByRootRequest;
  }

  const testCases: {[P in keyof IRequestTypes]: IRequestTypes[P][]} = {
    [Method.Status]: [createStatus()],
    [Method.Goodbye]: [BigInt(0), BigInt(1)],
    [Method.Ping]: [BigInt(0), BigInt(1)],
    [Method.Metadata]: [],
    [Method.BeaconBlocksByRange]: [{startSlot: 10, count: 20, step: 1}],
    [Method.BeaconBlocksByRoot]: [generateRoots(4, 0xda)],
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
