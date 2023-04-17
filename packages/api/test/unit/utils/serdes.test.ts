import {expect} from "chai";
import {fromGraffitiHex, toGraffitiHex} from "../../../src/utils/serdes.js";

describe("utils / serdes", () => {
  describe("toGraffitiHex", () => {
    it("should convert a UTF-8 graffiti to hex", () => {
      expect(toGraffitiHex("a".repeat(32))).to.equal(
        "0x6161616161616161616161616161616161616161616161616161616161616161"
      );
    });

    it("should convert a graffiti with Unicode symbols to hex", () => {
      expect(toGraffitiHex("🦇🔊".repeat(4))).to.equal(
        "0xf09fa687f09f948af09fa687f09f948af09fa687f09f948af09fa687f09f948a"
      );
    });

    it("should trim the hex graffiti if it is too long", () => {
      expect(toGraffitiHex("a".repeat(50))).to.equal(toGraffitiHex("a".repeat(32)));
    });

    it("should trim the hex graffiti if the last character is a Unicode symbol", () => {
      expect(toGraffitiHex("a".repeat(31) + "🐼")).to.equal(
        "0x61616161616161616161616161616161616161616161616161616161616161f0"
      );
    });

    it("should right-pad the hex graffiti with zeros if it is too short", () => {
      expect(toGraffitiHex("a")).to.equal("0x6100000000000000000000000000000000000000000000000000000000000000");
      expect(toGraffitiHex("ab")).to.equal("0x6162000000000000000000000000000000000000000000000000000000000000");
      expect(toGraffitiHex("abc")).to.equal("0x6162630000000000000000000000000000000000000000000000000000000000");
    });
  });

  describe("fromGraffitiHex", () => {
    it("should convert a hex graffiti to UTF-8", () => {
      expect(fromGraffitiHex("0x6161616161616161616161616161616161616161616161616161616161616161")).to.equal(
        "a".repeat(32)
      );
    });

    it("should convert a hex graffiti with Unicode symbols to UTF-8", () => {
      expect(fromGraffitiHex("0xf09fa687f09f948af09fa687f09f948af09fa687f09f948af09fa687f09f948a")).to.equal(
        "🦇🔊".repeat(4)
      );
    });

    it("should convert a padded hex graffiti to UTF-8", () => {
      expect(fromGraffitiHex("0x6100000000000000000000000000000000000000000000000000000000000000")).to.equal(
        // null bytes will not be displayed/ignored later on
        "a" + "\u0000".repeat(31)
      );
    });

    it("should decode a hex graffiti with a cut off Unicode character at the end", () => {
      expect(fromGraffitiHex("0x61616161616161616161616161616161616161616161616161616161616161f0")).to.equal(
        // last character will be displayed as �
        "a".repeat(31) + "\ufffd"
      );
    });

    it("should not throw an error if an invalid hex graffiti is provided", () => {
      expect(() => fromGraffitiHex("a")).to.not.throw();
    });

    it("should return the provided graffiti string if decoding fails", () => {
      expect(fromGraffitiHex("a")).to.equal("a");
    });
  });
});
