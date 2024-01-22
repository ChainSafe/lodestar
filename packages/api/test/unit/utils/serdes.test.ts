import {describe, it, expect} from "vitest";
import {fromGraffitiHex, toGraffitiHex} from "../../../src/utils/serdes.js";

describe("utils / serdes", () => {
  describe("toGraffitiHex", () => {
    it("should convert a UTF-8 graffiti to hex", () => {
      expect(toGraffitiHex("a".repeat(32))).toBe("0x6161616161616161616161616161616161616161616161616161616161616161");
    });

    it("should convert a graffiti with Unicode symbols to hex", () => {
      expect(toGraffitiHex("🦇🔊".repeat(4))).toBe(
        "0xf09fa687f09f948af09fa687f09f948af09fa687f09f948af09fa687f09f948a"
      );
    });

    it("should trim the hex graffiti if it is too long", () => {
      expect(toGraffitiHex("a".repeat(50))).toBe(toGraffitiHex("a".repeat(32)));
    });

    it("should trim the hex graffiti if the last character is a Unicode symbol", () => {
      expect(toGraffitiHex("a".repeat(31) + "🐼")).toBe(
        "0x61616161616161616161616161616161616161616161616161616161616161f0"
      );
    });

    it("should right-pad the hex graffiti with zeros if it is too short", () => {
      expect(toGraffitiHex("a")).toBe("0x6100000000000000000000000000000000000000000000000000000000000000");
      expect(toGraffitiHex("ab")).toBe("0x6162000000000000000000000000000000000000000000000000000000000000");
      expect(toGraffitiHex("abc")).toBe("0x6162630000000000000000000000000000000000000000000000000000000000");
    });
  });

  describe("fromGraffitiHex", () => {
    it("should convert a hex graffiti to UTF-8", () => {
      expect(fromGraffitiHex("0x6161616161616161616161616161616161616161616161616161616161616161")).toBe(
        "a".repeat(32)
      );
    });

    it("should convert a hex graffiti with Unicode symbols to UTF-8", () => {
      expect(fromGraffitiHex("0xf09fa687f09f948af09fa687f09f948af09fa687f09f948af09fa687f09f948a")).toBe(
        "🦇🔊".repeat(4)
      );
    });

    it("should convert a padded hex graffiti to UTF-8", () => {
      expect(fromGraffitiHex("0x6100000000000000000000000000000000000000000000000000000000000000")).toBe(
        // null bytes will not be displayed/ignored later on
        "a" + "\u0000".repeat(31)
      );
    });

    it("should decode a hex graffiti with a cut off Unicode character at the end", () => {
      expect(fromGraffitiHex("0x61616161616161616161616161616161616161616161616161616161616161f0")).toBe(
        // last character will be displayed as �
        "a".repeat(31) + "\ufffd"
      );
    });

    it("should not throw an error if an invalid hex graffiti is provided", () => {
      expect(() => fromGraffitiHex("a")).not.toThrow();
    });

    it("should return the provided graffiti string if decoding fails", () => {
      expect(fromGraffitiHex("a")).toBe("a");
    });
  });
});
