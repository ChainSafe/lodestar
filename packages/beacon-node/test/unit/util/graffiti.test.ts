import {describe, expect, it} from "vitest";
import {ClientCode} from "../../../src/execution/index.js";
import {getDefaultGraffiti, toGraffitiBuffer} from "../../../src/util/graffiti.js";

describe("Graffiti helper", () => {
  describe("toGraffitiBuffer", () => {
    const cases: {input: string; result: string}[] = [
      {
        // Pad short strings with zeros
        input: "chainsafe/lodestar",
        result: "636861696e736166652f6c6f6465737461720000000000000000000000000000",
      },
      {
        // Empty strings should become a zero hash
        input: "",
        result: "0000000000000000000000000000000000000000000000000000000000000000",
      },
      {
        // Really long string that should be cropped
        input: "a".repeat(96),
        result: "6161616161616161616161616161616161616161616161616161616161616161",
      },
    ];
    for (const {input, result} of cases) {
      it(`Convert graffiti UTF8 ${input} to Buffer`, () => {
        expect(toGraffitiBuffer(input).toString("hex")).toBe(result);
      });
    }
  });

  describe("getDefaultGraffiti", () => {
    const executionClientVersion = {code: ClientCode.BU, name: "Besu", version: "24.1.1", commit: "9b0e38fa"};
    const consensusClientVersion = {
      code: ClientCode.LS,
      name: "Lodestar",
      version: "v0.36.0/80c248b",
      commit: "80c248bb",
    }; // Sample output of getLodestarClientVersion()

    it("should return empty if private option is set", () => {
      const result = getDefaultGraffiti(consensusClientVersion, executionClientVersion, {private: true});
      expect(result).toBe("");
    });

    it("should return CL only info if EL client version is missing", () => {
      const result = getDefaultGraffiti(consensusClientVersion, undefined, {private: false});
      expect(result).toBe("LS80c2");
    });

    it("should return combined version codes and commits if executionClientVersion is provided", () => {
      const result = getDefaultGraffiti(consensusClientVersion, executionClientVersion, {private: false});
      expect(result).toBe("BU9b0eLS80c2");
    });
  });
});
