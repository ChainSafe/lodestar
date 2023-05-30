import {expect} from "chai";
import {stripOffNewlines} from "../../../src/util/index.js";

describe("stripOffNewlines", () => {
  it("should remove trailing newlines from a string", () => {
    expect(stripOffNewlines("1231321\n")).to.equal("1231321");
    expect(stripOffNewlines("1231321\r")).to.equal("1231321");
    expect(stripOffNewlines("1231321\r\n")).to.equal("1231321");
    expect(stripOffNewlines("1231321\n\n\r")).to.equal("1231321");
    expect(stripOffNewlines("1231321\n\r\n")).to.equal("1231321");
    expect(stripOffNewlines("\n\r\n")).to.equal("");
  });

  it("should not remove pipe character(s) at the end of a string", () => {
    expect(stripOffNewlines("1231321|")).to.equal("1231321|");
    expect(stripOffNewlines("1231321||")).to.equal("1231321||");
    expect(stripOffNewlines("1231321|||")).to.equal("1231321|||");
  });

  it("should not remove newlines in the middle of a string", () => {
    expect(stripOffNewlines("123\n1321\n\n\n")).to.equal("123\n1321");
  });

  it("should not modify the string if there are no new lines", () => {
    expect(stripOffNewlines("1231321")).to.equal("1231321");
    expect(stripOffNewlines("")).to.equal("");
  });

  it("should not mutate the original string", () => {
    const originalString = "123\n1321\n\n\n";
    stripOffNewlines(originalString);
    expect(originalString).to.equal("123\n1321\n\n\n");
  });
});
