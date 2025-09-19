import {LogLevel} from "@lodestar/logger";
import {getEnvLogger} from "@lodestar/logger/env";
import {beforeEach, describe, expect, it} from "vitest";
import {AnyWeb3Provider, Web3ProviderType} from "../../src/interfaces.js";
import web3JsProviderType from "../../src/provider_types/web3_js_provider_type.js";
import {Web3ProviderInspector} from "../../src/web3_provider_inspector.js";

describe("Web3ProviderInspector", () => {
  let inspector: Web3ProviderInspector;
  let customType: Web3ProviderType<AnyWeb3Provider>;

  beforeEach(() => {
    customType = {
      ...web3JsProviderType,
      name: "custom",
    };
    inspector = Web3ProviderInspector.initWithDefault({logger: getEnvLogger({level: LogLevel.debug})});
  });

  it("should have pre-registered types", () => {
    expect(inspector.getProviderTypes()).toHaveLength(4);
    expect(inspector.getProviderTypes().map((t) => t.name)).toEqual(["web3js", "ethers", "eip1193", "legacy"]);
  });

  describe("register", () => {
    it("should raise error if try to register pre-existing type", () => {
      expect(() => inspector.register(web3JsProviderType)).toThrowError(
        "Provider type 'web3js' is already registered."
      );
    });

    it("should register at max index if provided a large value", () => {
      expect(() => inspector.register(customType, {index: 10})).not.toThrowError();
      expect(inspector.getProviderTypes().map((t) => t.name)).toEqual([
        "web3js",
        "ethers",
        "eip1193",
        "legacy",
        "custom",
      ]);
    });

    it("should register at start index if provided a lower value", () => {
      expect(() => inspector.register(customType, {index: -1})).not.toThrowError();
      expect(inspector.getProviderTypes().map((t) => t.name)).toEqual([
        "custom",
        "web3js",
        "ethers",
        "eip1193",
        "legacy",
      ]);
    });

    it("should make space for existing index", () => {
      expect(() => inspector.register(customType, {index: 2})).not.toThrowError();
      expect(inspector.getProviderTypes().map((t) => t.name)).toEqual([
        "web3js",
        "ethers",
        "custom",
        "eip1193",
        "legacy",
      ]);
    });
  });

  describe("unregister", () => {
    it("should unregister provider type given the name", () => {
      inspector.unregister("ethers");
      expect(inspector.getProviderTypes().map((t) => t.name)).toEqual(["web3js", "eip1193", "legacy"]);
    });

    it("should raise error if given name is not registered", () => {
      expect(() => inspector.unregister("custom")).toThrowError("Provider type 'custom' is not registered.");
    });

    it("should unregister provider type given the index", () => {
      inspector.unregister(2);
      expect(inspector.getProviderTypes().map((t) => t.name)).toEqual(["web3js", "ethers", "legacy"]);
    });

    it("should raise error if given index not available", () => {
      expect(() => inspector.unregister(10)).toThrowError("Provider type at index '10' is not registered.");
    });
  });
});
