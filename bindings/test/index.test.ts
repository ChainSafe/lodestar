import {describe, expect, it} from "vitest";

describe("sanity", () => {
  it("should load bindings", async () => {
    const bindings = await import("../src/index.js");
    expect(bindings).toBeDefined();
  });
});
