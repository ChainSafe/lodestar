import {expect} from "chai";
import {phase0} from "@chainsafe/lodestar-types";
import {collectResponses} from "../../../../../src/network/reqresp/request/collectResponses";
import {Method} from "../../../../../src/constants";
import {arrToSource} from "../utils";

describe("network / reqresp / request / collectResponses", () => {
  const chunk: phase0.ResponseBody = BigInt(1);

  const testCases: {
    id: string;
    method: Method;
    maxResponses?: number;
    sourceChunks: phase0.ResponseBody[];
    expectedReturn: phase0.ResponseBody | phase0.ResponseBody[];
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
