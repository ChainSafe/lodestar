import {serializeContext} from "../../../src/logger";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

describe("log format", function () {

  describe("serialize context", function () {
    it("should serialize context", function () {
      const serialized = serializeContext({
        array: config.types.Uint64.hashTreeRoot(10n),
        buffer: Buffer.alloc(2, 0),
        string: "test",
        bigint: 10n
      });
      expect(serialized)
        .to.equal(
          "array=0x0a00000000000000000000000000000000000000000000000000000000000000,"
          +" buffer=0x0000, string=test, bigint=10"
        );
    });

    it("should serialize string context", function () {
      const context = "Error as a string" as any;
      const serialized = serializeContext(context);
      expect(serialized).to.equal(context);
    });
  });

});
