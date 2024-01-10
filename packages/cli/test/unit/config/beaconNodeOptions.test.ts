import {describe, it, expect} from "vitest";
import {defaultOptions} from "@lodestar/beacon-node";
import {BeaconNodeOptions} from "../../../src/config/index.js";

describe("config / beaconNodeOptions", () => {
  it("Should return goerli options", () => {
    const beaconNodeOptions = new BeaconNodeOptions({});

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.getWithDefaults();
    expect(optionsPartial?.api?.rest?.port).toBe(defaultOptions.api.rest.port);
  });

  it("Should return added partial options", () => {
    const initialPartialOptions = {eth1: {enabled: true}};
    const editedPartialOptions = {eth1: {enabled: false}};

    const beaconNodeOptions = new BeaconNodeOptions(initialPartialOptions);
    beaconNodeOptions.set(editedPartialOptions);

    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial).toEqual(editedPartialOptions);
  });
});
