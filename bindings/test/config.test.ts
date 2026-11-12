import {createChainForkConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/configs";
import {networksChainConfig} from "@lodestar/config/networks";
import {describe, expect, it} from "vitest";
import bindings from "../src/index.js";

describe("BeaconConfig", () => {
  describe.each([
    {field: "FULU_FORK_EPOCH", override: (value: number) => ({FULU_FORK_EPOCH: value})},
    {field: "HEZE_FORK_EPOCH", override: (value: number) => ({HEZE_FORK_EPOCH: value})},
    {
      field: "BLOB_SCHEDULE.EPOCH",
      override: (value: number) => ({BLOB_SCHEDULE: [{EPOCH: value, MAX_BLOBS_PER_BLOCK: 9}]}),
    },
    {
      field: "BLOB_SCHEDULE.MAX_BLOBS_PER_BLOCK",
      override: (value: number) => ({BLOB_SCHEDULE: [{EPOCH: 0, MAX_BLOBS_PER_BLOCK: value}]}),
    },
  ])("$field", ({override}) => {
    it.each([0, 2 ** 32, Number.MAX_SAFE_INTEGER, Infinity])("accepts %s", (value) => {
      const config = {...mainnetChainConfig, ...override(value)};
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).not.toThrow();
    });

    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 2 ** 64, -Infinity, NaN])("rejects %s", (value) => {
      const config = {...mainnetChainConfig, ...override(value)};
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).toThrow("InvalidChainConfigFieldValue");
    });
  });

  it("accepts a four-byte Heze fork version", () => {
    const config = {...mainnetChainConfig, HEZE_FORK_VERSION: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])};
    expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).not.toThrow();
  });

  it.each([0, 3, 5])("rejects a Heze fork version of length %s", (length) => {
    const config = {...mainnetChainConfig, HEZE_FORK_VERSION: new Uint8Array(length)};
    expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).toThrow("InvalidVersionLength");
  });

  describe.each(["SLOT_DURATION_MS", "SLOT_DURATION_MS_HEZE"])("%s", (field) => {
    it.each([1000, 5000, 10000, 24000])("accepts %s ms", (value) => {
      const config = {...mainnetChainConfig, [field]: value};
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).not.toThrow();
    });

    it.each([0, 1, 1500, Infinity])("rejects %s ms", (value) => {
      const config = {...mainnetChainConfig, [field]: value};
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).toThrow("InvalidSlotDuration");
    });

    it.each([-1000, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])("rejects invalid integer %s", (value) => {
      const config = {...mainnetChainConfig, [field]: value};
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).toThrow("InvalidChainConfigFieldValue");
    });
  });

  it.each([0, 31, 33])("rejects a genesis validators root of length %s", (length) => {
    expect(() => new bindings.BeaconConfig(mainnetChainConfig, new Uint8Array(length))).toThrow(
      "InvalidGenesisValidatorsRootLength"
    );
  });

  for (const [name, chainConfig] of Object.entries(networksChainConfig)) {
    if (chainConfig.PRESET_BASE !== mainnetChainConfig.PRESET_BASE) continue;

    it(`parses ${name}`, () => {
      const config = createChainForkConfig(
        name === "ephemery"
          ? {...chainConfig, DEPOSIT_CHAIN_ID: 39438000, DEPOSIT_NETWORK_ID: 39438000, MIN_GENESIS_TIME: 1638471600}
          : chainConfig
      );
      expect(() => new bindings.BeaconConfig(config, new Uint8Array(32))).not.toThrow();
    });
  }
});
