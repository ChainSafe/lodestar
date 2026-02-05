import {describe, expect, it} from "vitest";
import {ClientCode} from "../../../src/execution/index.js";
import {
  appendClientInfoToGraffiti,
  getDefaultGraffiti,
  toGraffitiBytes,
  truncateUtf8ToBytes,
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
      const result = getDefaultGraffiti(consensusClientVersion, undefined, {private: false});
      expect(result).toBe("LS80c2");
    });

    it("should return combined version codes and commits if executionClientVersion is provided", () => {
      const result = getDefaultGraffiti(consensusClientVersion, executionClientVersion, {private: false});
      expect(result).toBe("BU9b0eLS80c2");
    });
  });

  describe("truncateUtf8ToBytes", () => {
    it("should not truncate strings within limit", () => {
      expect(truncateUtf8ToBytes("hello", 10)).toBe("hello");
    });

    it("should truncate ASCII strings correctly", () => {
      expect(truncateUtf8ToBytes("hello world", 5)).toBe("hello");
    });

    it("should not split multi-byte UTF-8 characters", () => {
      // "é" is 2 bytes (c3 a9), truncating at 1 byte should give empty string
      expect(truncateUtf8ToBytes("é", 1)).toBe("");
      // "😀" is 4 bytes, truncating at 3 should give empty string
      expect(truncateUtf8ToBytes("😀", 3)).toBe("");
      // "aé" is 3 bytes, truncating at 2 should give just "a"
      expect(truncateUtf8ToBytes("aé", 2)).toBe("a");
    });

    it("should handle empty strings", () => {
      expect(truncateUtf8ToBytes("", 10)).toBe("");
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

    it("should append full client info for short graffiti with EL", () => {
      // Short graffiti + space + full 12-byte client info = well under 32 bytes
      const result = appendClientInfoToGraffiti("my graffiti", consensusClientVersion, executionClientVersion);
      expect(result).toBe("my graffiti BU9b0eLS80c2");
    });

    it("should return just client info for empty graffiti", () => {
      const result = appendClientInfoToGraffiti("", consensusClientVersion, executionClientVersion);
      expect(result).toBe("BU9b0eLS80c2");
    });

    it("should handle CL-only (no EL)", () => {
      const result = appendClientInfoToGraffiti("my graffiti", consensusClientVersion, undefined);
      expect(result).toBe("my graffiti LS80c2");
    });

    it("should return CL-only info for empty graffiti when EL unavailable", () => {
      const result = appendClientInfoToGraffiti("", consensusClientVersion, undefined);
      expect(result).toBe("LS80c2");
    });

    it("should truncate when combined exceeds 32 bytes", () => {
      // 25-byte graffiti + 1 space + 12 client info = 38 bytes, must truncate
      const graffiti = "1234567890123456789012345";
      expect(Buffer.byteLength(graffiti, "utf8")).toBe(25);
      const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(32);
      // Should contain truncated graffiti + partial client info
      expect(result.startsWith("1234567890123456789012345 ")).toBe(true);
    });

    it("should handle 19-byte graffiti with full client info (exactly 32 bytes)", () => {
      // 19 bytes + 1 space + 12 bytes = 32 bytes exactly
      const graffiti = "1234567890123456789";
      expect(Buffer.byteLength(graffiti, "utf8")).toBe(19);
      const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
      expect(result).toBe("1234567890123456789 BU9b0eLS80c2");
      expect(Buffer.byteLength(result, "utf8")).toBe(32);
    });

    it("should handle 25-byte graffiti with CL-only (exactly 32 bytes)", () => {
      // 25 bytes + 1 space + 6 bytes = 32 bytes exactly
      const graffiti = "1234567890123456789012345";
      expect(Buffer.byteLength(graffiti, "utf8")).toBe(25);
      const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, undefined);
      expect(result).toBe("1234567890123456789012345 LS80c2");
      expect(Buffer.byteLength(result, "utf8")).toBe(32);
    });

    it("should truncate 32-byte graffiti leaving partial client info", () => {
      const fullGraffiti = "a".repeat(32);
      const result = appendClientInfoToGraffiti(fullGraffiti, consensusClientVersion, executionClientVersion);
      // 32 a's + space + client info = 45 bytes, truncated to 32
      expect(Buffer.byteLength(result, "utf8")).toBe(32);
      // Original graffiti will be truncated to make room for space + partial client info
      expect(result).toBe("a".repeat(32));
    });

    it("should not exceed 32 bytes for various inputs", () => {
      const testCases = [
        {graffiti: "", el: executionClientVersion},
        {graffiti: "short", el: executionClientVersion},
        {graffiti: "medium length graffiti", el: executionClientVersion},
        {graffiti: "a".repeat(28), el: executionClientVersion},
        {graffiti: "a".repeat(32), el: executionClientVersion},
        {graffiti: "a".repeat(40), el: executionClientVersion},
        {graffiti: "", el: undefined},
        {graffiti: "short", el: undefined},
        {graffiti: "a".repeat(30), el: undefined},
      ];

      for (const {graffiti, el} of testCases) {
        const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, el);
        const byteLength = Buffer.byteLength(result, "utf8");
        expect(byteLength).toBeLessThanOrEqual(32);
      }
    });

    it("should respect private mode and not append client info", () => {
      const result = appendClientInfoToGraffiti("my graffiti", consensusClientVersion, executionClientVersion, {
        private: true,
      });
      expect(result).toBe("my graffiti");
      // Should not contain any client info
      expect(result).not.toContain("BU");
      expect(result).not.toContain("LS");
    });

    it("should truncate graffiti in private mode", () => {
      const longGraffiti = "a".repeat(40);
      const result = appendClientInfoToGraffiti(longGraffiti, consensusClientVersion, executionClientVersion, {
        private: true,
      });
      expect(Buffer.byteLength(result, "utf8")).toBe(32);
      expect(result).toBe("a".repeat(32));
    });

    it("should handle UTF-8 emoji graffiti", () => {
      // "🚀" is 4 bytes UTF-8
      const graffiti = "🚀";
      expect(Buffer.byteLength(graffiti, "utf8")).toBe(4);
      const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
      expect(result).toBe("🚀 BU9b0eLS80c2");
      expect(Buffer.byteLength(result, "utf8")).toBe(17); // 4 + 1 + 12
    });

    it("should handle multi-byte UTF-8 truncation without splitting characters", () => {
      // "a" * 29 + "😀" = 33 bytes, when combined with client info and truncated
      // should not produce invalid UTF-8
      const graffiti = "a".repeat(29) + "😀";
      expect(Buffer.byteLength(graffiti, "utf8")).toBe(33);
      const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, undefined);
      // Result should be valid UTF-8 and <= 32 bytes
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(32);
      // Verify the result is valid UTF-8 by encoding and decoding
      const encoded = Buffer.from(result, "utf8");
      const decoded = encoded.toString("utf8");
      expect(decoded).toBe(result);
    });
  });
});
