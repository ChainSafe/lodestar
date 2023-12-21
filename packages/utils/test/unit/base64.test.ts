import {describe, it, expect} from "vitest";
import {toBase64, fromBase64} from "../../src/index.js";

describe("toBase64", () => {
  it("should encode UTF-8 string as base64 string", () => {
    expect(toBase64("user:password")).toBe("dXNlcjpwYXNzd29yZA==");
  });
});

describe("fromBase64", () => {
  it("should decode UTF-8 string from base64 string", () => {
    expect(fromBase64("dXNlcjpwYXNzd29yZA==")).toBe("user:password");
  });
});
