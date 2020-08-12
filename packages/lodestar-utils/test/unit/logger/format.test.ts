import {serializeContext} from "../../../src/logger";
import {expect} from "chai";

describe("log format", function () {

  describe("serialize context", function () {
    it("should serialize context", function () {
      const serialized = serializeContext({
        object: {
          foo: "bar",
          baz: 1,
        },
        array: ["a", "small", "array"],
        string: "test",
        number: 3,
        bool: true,
      });
      expect(serialized)
        .to.equal(
          "object={\"foo\":\"bar\",\"baz\":1},"
          +" array=[\"a\",\"small\",\"array\"],"
          +" string=test, number=3, bool=true"
        );
    });

    it("should serialize string context", function () {
      const context = "Error as a string" as any;
      const serialized = serializeContext(context);
      expect(serialized).to.equal(context);
    });
  });

});
