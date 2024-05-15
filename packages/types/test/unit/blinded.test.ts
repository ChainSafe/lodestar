import {describe, it, expect} from "vitest";
import {ContainerType} from "@chainsafe/ssz";
import {ssz} from "../../src/index.js";

describe("blinded datastructures", function () {
  it("should have the same number of fields as non-blinded", () => {
    const blindedTypes = [
      {a: "BlindedBeaconBlockBody", b: "BeaconBlockBody"},
      {a: "ExecutionPayloadHeader", b: "ExecutionPayload"},
    ];

    for (const {a, b} of blindedTypes) {
      for (const fork of Object.keys(ssz.allForks) as (keyof typeof ssz.allForks)[]) {
        // @ts-expect-error generic string typenames used across forks
        const blindedType = ssz[fork][a] as ContainerType<any> | undefined;
        // @ts-expect-error generic string typenames used across forks
        const type = ssz[fork][b] as ContainerType<any> | undefined;

        if (!blindedType || !type) {
          continue;
        }

        expect(
          Object.keys(blindedType.fields).length,
          // eslint-disable-next-line vitest/valid-expect
          `fork: ${fork}, types ${a} and ${b} have different number of fields`
        ).toBe(Object.keys(type.fields).length);
      }
    }
  });
});
