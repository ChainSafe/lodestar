import {describe, expect, it} from "vitest";
import {LightclientSpec} from "../../src/lightClient/spec/index.js";

describe("light client browser bundle", () => {
  it("loads with the browser BLS implementation", () => {
    expect(LightclientSpec).toBeTypeOf("function");
  });
});
