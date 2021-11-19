import {expect} from "chai";
import {collectResponses} from "../../../../../src/network/reqresp/request/collectResponses";
import {Method, IncomingResponseBody} from "../../../../../src/network/reqresp/types";
import {arrToSource} from "../utils";

describe("network / reqresp / request / collectResponses", () => {
  const chunk: IncomingResponseBody = BigInt(1);

  const testCases: {
    id: string;
    method: Method;
    maxResponses?: number;
    sourceChunks: IncomingResponseBody[];
    expectedReturn: IncomingResponseBody | IncomingResponseBody[];
  }[] = [
    {
      id: "Return first chunk only for a single-chunk method",
      method: Method.Ping,
      sourceChunks: [chunk, chunk],
      expectedReturn: chunk,
    },
    {
      id: "Return up to maxResponses for a multi-chunk method",
      method: Method.BeaconBlocksByRange,
      sourceChunks: [chunk, chunk, chunk],
      maxResponses: 2,
      expectedReturn: [chunk, chunk],
    },
  ];

  for (const {id, method, maxResponses, sourceChunks, expectedReturn} of testCases) {
    it(id, async () => {
      const responses = await collectResponses(method, maxResponses)(arrToSource(sourceChunks));
      expect(responses).to.deep.equal(expectedReturn);
    });
  }
});
