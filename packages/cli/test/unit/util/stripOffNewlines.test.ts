import {describe, it, expect} from "vitest";
import {stripOffNewlines} from "../../../src/util/index.js";

describe("stripOffNewlines", () => {
  it("should remove trailing newlines from a string", () => {
    expect(stripOffNewlines("1231321\n")).toBe("1231321");
    expect(stripOffNewlines("1231321\r")).toBe("1231321");
    expect(stripOffNewlines("1231321\r\n")).toBe("1231321");
    expect(stripOffNewlines("1231321\n\n\r")).toBe("1231321");
    expect(stripOffNewlines("1231321\n\r\n")).toBe("1231321");
    expect(stripOffNewlines("\n\r\n")).toBe("");
  });

  it("should not remove pipe character(s) at the end of a string", () => {
    expect(stripOffNewlines("1231321|")).toBe("1231321|");
    expect(stripOffNewlines("1231321||")).toBe("1231321||");
    expect(stripOffNewlines("1231321|||")).toBe("1231321|||");
  });

  it("should not remove newlines in the middle of a string", () => {
    expect(stripOffNewlines("123\n1321\n\n\n")).toBe("123\n1321");
  });

  it("should not modify the string if there are no new lines", () => {
    expect(stripOffNewlines("1231321")).toBe("1231321");
    expect(stripOffNewlines("")).toBe("");
  });

  it("should not mutate the original string", () => {
    const originalString = "123\n1321\n\n\n";
    stripOffNewlines(originalString);
    expect(originalString).toBe("123\n1321\n\n\n");
  });
});
