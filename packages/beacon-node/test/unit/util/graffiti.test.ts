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
      // Short graffiti (10 chars) leaves 32 - 10 - 1 (separator) = 21 bytes for client info
      // Full format is 12 chars "BU9b0eLS80c2"
      const result = appendClientInfoToGraffiti("my graffiti", consensusClientVersion, executionClientVersion);
      expect(result).toBe("my graffiti BU9b0eLS80c2");
    });

    it("should append compact client info for medium graffiti with EL", () => {
      // 20 char graffiti leaves 32 - 20 - 1 = 11 bytes, not enough for full (12), use compact (8)
      const result = appendClientInfoToGraffiti("12345678901234567890", consensusClientVersion, executionClientVersion);
      expect(result).toBe("12345678901234567890 BU9bLS80");
    });

    it("should append codes only for longer graffiti with EL", () => {
      // 25 char graffiti leaves 32 - 25 - 1 = 6 bytes, not enough for compact (8), use codes (4)
      const result = appendClientInfoToGraffiti(
        "1234567890123456789012345",
        consensusClientVersion,
        executionClientVersion
      );
      expect(result).toBe("1234567890123456789012345 BULS");
    });

    // Teku compatibility tests - ported from GraffitiBuilderTest.java
    describe("Teku compatibility", () => {
      // ASCII_GRAFFITI_27 = "27 bytes of user's graffiti" (27 bytes)
      // ASCII_GRAFFITI_28 = "28 bytes of user's graffiti!" (28 bytes)
      // ASCII_GRAFFITI_30 = "30 bytes of a user's graffiti!" (30 bytes)

      it("should append codes with space for 27-byte graffiti (Teku: AUTO)", () => {
        // 27 bytes + 1 space + 4 codes = 32 bytes exactly
        const graffiti = "27 bytes of user's graffiti";
        expect(Buffer.byteLength(graffiti, "utf8")).toBe(27);
        const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
        expect(result).toBe("27 bytes of user's graffiti BULS");
        expect(Buffer.byteLength(result, "utf8")).toBe(32);
      });

      it("should append codes WITHOUT space for 28-byte graffiti (Teku: AUTO)", () => {
        // Teku special case: 28 bytes + 4 codes = 32 bytes (drops separator)
        // With separator: 28 + 1 + 4 = 33 > 32 (doesn't fit)
        // Without separator: 28 + 4 = 32 (fits exactly!)
        const graffiti = "28 bytes of user's graffiti!";
        expect(Buffer.byteLength(graffiti, "utf8")).toBe(28);
        const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
        expect(result).toBe("28 bytes of user's graffiti!BULS");
        expect(Buffer.byteLength(result, "utf8")).toBe(32);
      });

      it("should append single EL code for 30-byte graffiti (Teku: CLIENT_CODES)", () => {
        // 30 bytes + 2 bytes EL code = 32 bytes (no space available)
        const graffiti = "30 bytes of a user's graffiti!";
        expect(Buffer.byteLength(graffiti, "utf8")).toBe(30);
        const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
        expect(result).toBe("30 bytes of a user's graffiti!BU");
        expect(Buffer.byteLength(result, "utf8")).toBe(32);
      });

      it("should append full watermark for empty graffiti", () => {
        const result = appendClientInfoToGraffiti("", consensusClientVersion, executionClientVersion);
        expect(result).toBe("BU9b0eLS80c2");
        expect(Buffer.byteLength(result, "utf8")).toBe(12);
      });

      it("should append full watermark with space for short graffiti", () => {
        const result = appendClientInfoToGraffiti("small", consensusClientVersion, executionClientVersion);
        expect(result).toBe("small BU9b0eLS80c2");
      });

      it("should handle UTF-8 emoji graffiti with space", () => {
        // 🚀 is 4 bytes UTF-8
        const graffiti = "🚀";
        expect(Buffer.byteLength(graffiti, "utf8")).toBe(4);
        const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
        expect(result).toBe("🚀 BU9b0eLS80c2");
        expect(Buffer.byteLength(result, "utf8")).toBe(17); // 4 + 1 + 12
      });

      // CL-only tests (EL info not available)
      it("should append CL watermark for empty graffiti when EL unavailable", () => {
        const result = appendClientInfoToGraffiti("", consensusClientVersion, undefined);
        expect(result).toBe("LS80c2");
        expect(Buffer.byteLength(result, "utf8")).toBe(6);
      });

      it("should append CL code without space for 28-byte graffiti when EL unavailable", () => {
        // Teku special case: 3 bytes remain → drop space, call formatClientsInfo(4)
        // For CL-only, formatClientsInfo(4) returns just CL code "TK" (2 bytes)
        const graffiti = "28 bytes of user's graffiti!";
        const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, undefined);
        // 28 + 2 (LS) = 30 bytes
        expect(result).toBe("28 bytes of user's graffiti!LS");
        expect(Buffer.byteLength(result, "utf8")).toBe(30);
      });

      it("should append CL code only for 30-byte graffiti when EL unavailable", () => {
        const graffiti = "30 bytes of a user's graffiti!";
        const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, undefined);
        // 30 + 2 (LS) = 32 bytes
        expect(result).toBe("30 bytes of a user's graffiti!LS");
        expect(Buffer.byteLength(result, "utf8")).toBe(32);
      });
    });

    it("should return unchanged for 32-byte graffiti", () => {
      const fullGraffiti = "a".repeat(32);
      const result = appendClientInfoToGraffiti(fullGraffiti, consensusClientVersion, executionClientVersion);
      expect(result).toBe(fullGraffiti);
    });

    it("should return just client info for empty graffiti", () => {
      const result = appendClientInfoToGraffiti("", consensusClientVersion, executionClientVersion);
      expect(result).toBe("BU9b0eLS80c2");
    });

    it("should handle CL-only (no EL)", () => {
      const result = appendClientInfoToGraffiti("my graffiti", consensusClientVersion, undefined);
      // CL only full is 6 chars "LS80c2"
      expect(result).toBe("my graffiti LS80c2");
    });

    it("should handle CL-only with longer graffiti", () => {
      // 26 char graffiti leaves 32 - 26 - 1 = 5 bytes, not enough for CL full (6), use CL compact (4)
      const result = appendClientInfoToGraffiti("12345678901234567890123456", consensusClientVersion, undefined);
      expect(result).toBe("12345678901234567890123456 LS80");
    });

    it("should not exceed 32 bytes", () => {
      const testCases = [
        {graffiti: "", el: executionClientVersion},
        {graffiti: "short", el: executionClientVersion},
        {graffiti: "medium length graffiti", el: executionClientVersion},
        {graffiti: "a".repeat(28), el: executionClientVersion},
        {graffiti: "a".repeat(32), el: executionClientVersion},
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

    it("should truncate >32 byte graffiti and still try to append client info", () => {
      // 40 ASCII chars, truncates to 32, no room for client info
      const longGraffiti = "a".repeat(40);
      const result = appendClientInfoToGraffiti(longGraffiti, consensusClientVersion, executionClientVersion);
      expect(result).toBe("a".repeat(32));
    });

    it("should handle multi-byte UTF-8 graffiti >32 bytes and append if space permits", () => {
      // "a" * 30 + "é" (2 bytes) = 32 bytes total, truncates to 31 after UTF-8 safe truncation
      // But actually "a" * 30 is 30 bytes, "é" is 2 bytes = 32 bytes, fits exactly
      // Let's use a case where truncation leaves room: "a" * 28 + "😀" (4 bytes) = 32 bytes
      // truncation at 32 bytes would keep it as is since it's exactly 32
      // Use "a" * 29 + "😀" = 33 bytes, truncates to 29 bytes (drops the emoji), leaving room for LS (2 bytes)
      const graffiti = "a".repeat(29) + "😀";
      const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, undefined);
      // After truncation: "a" * 29 (29 bytes), available: 32 - 29 - 1 = 2 bytes, fits "LS"
      expect(result).toBe("a".repeat(29) + " LS");
      expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(32);
    });

    it("should handle multi-byte UTF-8 near boundary without exceeding 32 bytes", () => {
      // "a" * 28 + "😀" = 32 bytes exactly, should return unchanged
      const graffiti = "a".repeat(28) + "😀";
      expect(Buffer.byteLength(graffiti, "utf8")).toBe(32);
      const result = appendClientInfoToGraffiti(graffiti, consensusClientVersion, executionClientVersion);
      expect(result).toBe(graffiti);
      expect(Buffer.byteLength(result, "utf8")).toBe(32);
    });
  });
});
