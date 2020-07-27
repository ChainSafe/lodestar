import "mocha";
import {expect} from "chai";
import {toGraffitiBuffer} from "../../../src/util/graffiti";

describe.only("Graffiti helper", () => {
  describe("toGraffitiBuffer", () => {
    const cases: {utf8: string; hex: string}[] = [
      {
        // Pad short strings with zeros
        utf8: "chainsafe/lodestar",
        hex: "636861696e736166652f6c6f6465737461720000000000000000000000000000"
      },
      {
        // Empty strings should become a zero hash
        utf8: "",
        hex: "0000000000000000000000000000000000000000000000000000000000000000"
      },
      {
        // Really long string that should be cropped
        utf8: "a".repeat(96),
        hex: "6161616161616161616161616161616161616161616161616161616161616161"
      }
    ];
    for (const {utf8, hex} of cases) {
      it(`Convert graffiti UTF8 ${utf8} to Buffer`, () => {
        expect(toGraffitiBuffer(utf8).toString("hex")).to.equal(hex);
      });
    }
  });
});
