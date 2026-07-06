import {describe, expect, it} from "vitest";
import {GRAFFITI_SIZE} from "../../../src/constants/index.js";
import {ClientCode} from "../../../src/execution/index.js";
import {
  appendClientInfoToGraffiti,
  getBlockGraffiti,
  getDefaultGraffiti,
  toGraffitiBytes,
} from "../../../src/util/graffiti.js";

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
        expect(Buffer.from(toGraffitiBytes(input)).toString("hex")).toBe(result);
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
      const result = getDefaultGraffiti(consensusClientVersion, null, {private: false});
      expect(result).toBe("LS80c2");
    });

    it("should return combined version codes and commits if executionClientVersion is provided", () => {
      const result = getDefaultGraffiti(consensusClientVersion, executionClientVersion, {private: false});
      expect(result).toBe("BU9b0eLS80c2");
    });
  });

  describe("appendClientInfoToGraffiti", () => {
    const executionClientVersion = {code: ClientCode.BU, name: "Besu", version: "24.1.1", commit: "9b0e38fa"};
    const consensusClientVersion = {
      code: ClientCode.LS,
      name: "Lodestar",
      version: "v0.36.0/80c248b",
      commit: "80c248bb",
    };

    it("should append the full EL and CL watermark when it fits", () => {
      expect(appendClientInfoToGraffiti("my graffiti", consensusClientVersion, executionClientVersion)).toBe(
        "my graffiti BU9b0eLS80c2"
      );
    });

    it("should append only EL and CL codes when the full watermark does not fit", () => {
      expect(appendClientInfoToGraffiti("a".repeat(20), consensusClientVersion, executionClientVersion)).toBe(
        `${"a".repeat(20)} BULS`
      );
    });

    it("should append only the CL code when only 3 bytes are available", () => {
      expect(appendClientInfoToGraffiti("a".repeat(29), consensusClientVersion, executionClientVersion)).toBe(
        `${"a".repeat(29)} LS`
      );
    });

    it("should preserve user graffiti exactly when appending a suffix", () => {
      for (const userGraffiti of ["my graffiti", "\u{1f600}".repeat(4), "a".repeat(29)]) {
        const result = appendClientInfoToGraffiti(userGraffiti, consensusClientVersion, executionClientVersion);
        expect(result.slice(0, userGraffiti.length)).toBe(userGraffiti);
        expect(result.length).toBeGreaterThan(userGraffiti.length);
      }
    });

    it("should leave user graffiti unchanged when no suffix fits", () => {
      expect(appendClientInfoToGraffiti("a".repeat(30), consensusClientVersion, executionClientVersion)).toBe(
        "a".repeat(30)
      );
      expect(appendClientInfoToGraffiti("a".repeat(32), consensusClientVersion, executionClientVersion)).toBe(
        "a".repeat(32)
      );
      expect(appendClientInfoToGraffiti("a".repeat(40), consensusClientVersion, executionClientVersion)).toBe(
        "a".repeat(40)
      );
      expect(appendClientInfoToGraffiti("\u{1f600}".repeat(9), consensusClientVersion, executionClientVersion)).toBe(
        "\u{1f600}".repeat(9)
      );
    });

    it("should append CL-only watermark when EL info is unavailable", () => {
      expect(appendClientInfoToGraffiti("my graffiti", consensusClientVersion, null)).toBe("my graffiti LS80c2");
    });

    it("should respect private mode", () => {
      expect(
        appendClientInfoToGraffiti("my graffiti", consensusClientVersion, executionClientVersion, {private: true})
      ).toBe("my graffiti");
      expect(
        appendClientInfoToGraffiti("a".repeat(40), consensusClientVersion, executionClientVersion, {private: true})
      ).toBe("a".repeat(40));
    });

    it("should strip trailing NUL padding before appending client info", () => {
      // Graffiti supplied via the beacon API is decoded from a fixed 32-byte field and is
      // right-padded with NUL bytes. Without stripping, availableBytes would be 0.
      const nul = String.fromCharCode(0);
      const paddedGraffiti = "my graffiti" + nul.repeat(GRAFFITI_SIZE - "my graffiti".length);
      expect(appendClientInfoToGraffiti(paddedGraffiti, consensusClientVersion, executionClientVersion)).toBe(
        "my graffiti BU9b0eLS80c2"
      );
    });

    it("should use the default watermark when graffiti is entirely NUL padding", () => {
      const paddedGraffiti = String.fromCharCode(0).repeat(GRAFFITI_SIZE);
      expect(appendClientInfoToGraffiti(paddedGraffiti, consensusClientVersion, executionClientVersion)).toBe(
        "BU9b0eLS80c2"
      );
    });

    it("should preserve mid-string NUL bytes and only trim trailing NUL padding", () => {
      const nul = String.fromCharCode(0);
      // Graffiti with a data NUL in the middle, followed by trailing padding
      const graffiti = "hello" + nul + "world" + nul.repeat(GRAFFITI_SIZE - 11);
      const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
      // The mid-string NUL must be preserved; only trailing NULs are stripped
      expect(result).toBe("hello" + nul + "world BU9b0eLS80c2");
    });
  });

  describe("getBlockGraffiti", () => {
    const executionClientVersion = {code: ClientCode.BU, name: "Besu", version: "24.1.1", commit: "9b0e38fa"};
    const consensusClientVersion = {
      code: ClientCode.LS,
      name: "Lodestar",
      version: "v0.36.0/80c248b",
      commit: "80c248bb",
    };

    it("should use the default watermark when no user graffiti is provided", () => {
      expect(getBlockGraffiti(undefined, consensusClientVersion, executionClientVersion, {graffitiAppend: true})).toBe(
        "BU9b0eLS80c2"
      );
    });

    it("should preserve user graffiti when append is disabled", () => {
      expect(
        getBlockGraffiti("my graffiti", consensusClientVersion, executionClientVersion, {graffitiAppend: false})
      ).toBe("my graffiti");
    });

    it("should preserve user graffiti when private mode is enabled", () => {
      expect(
        getBlockGraffiti("my graffiti", consensusClientVersion, executionClientVersion, {
          private: true,
          graffitiAppend: true,
        })
      ).toBe("my graffiti");
    });

    it("should preserve NUL-padded graffiti when append is disabled", () => {
      const nul = String.fromCharCode(0);
      const paddedGraffiti = "my graffiti" + nul.repeat(GRAFFITI_SIZE - "my graffiti".length);
      expect(
        getBlockGraffiti(paddedGraffiti, consensusClientVersion, executionClientVersion, {graffitiAppend: false})
      ).toBe(paddedGraffiti);
    });

    it("should append client info to NUL-padded graffiti as received from the beacon API", () => {
      const nul = String.fromCharCode(0);
      const paddedGraffiti = "my graffiti" + nul.repeat(GRAFFITI_SIZE - "my graffiti".length);
      expect(
        getBlockGraffiti(paddedGraffiti, consensusClientVersion, executionClientVersion, {graffitiAppend: true})
      ).toBe("my graffiti BU9b0eLS80c2");
    });
  });
});
