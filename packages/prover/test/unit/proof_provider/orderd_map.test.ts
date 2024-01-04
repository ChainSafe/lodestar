import {describe, it, expect} from "vitest";
import {OrderedMap} from "../../../src/proof_provider/ordered_map.js";

describe("proof_provider/ordered_map", () => {
  it("should initialize the min with undefined", () => {
    const omap = new OrderedMap<string>();

    expect(omap.min).toBeUndefined();
  });

  it("should initialize the max with undefined", () => {
    const omap = new OrderedMap<string>();

    expect(omap.max).toBeUndefined();
  });

  it("should set the min and max to the first value ", () => {
    const omap = new OrderedMap<string>();
    omap.set(11, "value");

    expect(omap.min).toEqual(11);
    expect(omap.max).toEqual(11);
  });

  it("should set the max value", () => {
    const omap = new OrderedMap<string>();
    omap.set(10, "value");
    omap.set(11, "value");

    expect(omap.max).toEqual(11);
  });

  it("should set the min value", () => {
    const omap = new OrderedMap<string>();
    omap.set(10, "value");
    omap.set(11, "value");

    expect(omap.min).toEqual(10);
  });
});
