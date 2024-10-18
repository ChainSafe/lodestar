import {describe, it, expect} from "vitest";
import {ForkName, isForkExecution} from "@lodestar/params";
import {ssz} from "../../src/index.js";

describe("blinded data structures", () => {
  it("should have the same number of fields as non-blinded", () => {
    const blindedTypes = [
      {a: "BlindedBeaconBlockBody" as const, b: "BeaconBlockBody" as const},
      {a: "ExecutionPayloadHeader" as const, b: "ExecutionPayload" as const},
    ];

    for (const {a, b} of blindedTypes) {
      for (const fork of Object.keys(ssz.sszTypesFor) as ForkName[]) {
        if (!isForkExecution(fork)) {
          continue;
        }

        const blindedType = ssz[fork][a];
        if (blindedType === undefined) {
          expect.fail(`fork: ${fork}, type ${a} is undefined`);
        }

        const type = ssz[fork][b];
        if (type === undefined) {
          expect.fail(`fork: ${fork}, type ${b} is undefined`);
        }

        expect(Object.keys(blindedType.fields).length).toBeWithMessage(
          Object.keys(type.fields).length,
          `fork: ${fork}, types ${a} and ${b} have different number of fields`
        );
      }
    }
  });
});
