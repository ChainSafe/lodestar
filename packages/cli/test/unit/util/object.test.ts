import {describe, expect, it} from "vitest";
import {flattenObject} from "../../../src/util/object.js";

describe("util / flattenObject", () => {
  it("flattens nested maps into dot-notation keys", () => {
    expect(flattenObject({rest: {address: "0.0.0.0", port: 9596}})).toEqual({
      "rest.address": "0.0.0.0",
      "rest.port": 9596,
    });
  });

  it("leaves already-dotted keys unchanged (backwards compatible)", () => {
    expect(flattenObject({"rest.address": "0.0.0.0", "rest.port": 9596})).toEqual({
      "rest.address": "0.0.0.0",
      "rest.port": 9596,
    });
  });

  it("preserves arrays as values instead of flattening them by index", () => {
    expect(flattenObject({rest: {namespace: ["beacon", "config"]}, bootnodes: ["enr:-a", "enr:-b"]})).toEqual({
      "rest.namespace": ["beacon", "config"],
      bootnodes: ["enr:-a", "enr:-b"],
    });
  });

  it("preserves primitive value types (boolean, number, null)", () => {
    expect(flattenObject({metrics: {enabled: true, port: 8008, host: null}})).toEqual({
      "metrics.enabled": true,
      "metrics.port": 8008,
      "metrics.host": null,
    });
  });

  it("supports nested and dotted keys mixed in the same object", () => {
    expect(flattenObject({rest: {address: "0.0.0.0"}, "rest.port": 9596, network: "hoodi"})).toEqual({
      "rest.address": "0.0.0.0",
      "rest.port": 9596,
      network: "hoodi",
    });
  });

  it("flattens arbitrarily deep nesting", () => {
    expect(flattenObject({a: {b: {c: 1}}})).toEqual({"a.b.c": 1});
  });

  it("returns top-level scalars untouched", () => {
    expect(flattenObject({network: "hoodi", port: 9000, rest: true})).toEqual({
      network: "hoodi",
      port: 9000,
      rest: true,
    });
  });

  it("last definition wins when a key is given in both nested and dotted form", () => {
    expect(flattenObject({"rest.address": "first", rest: {address: "second"}})).toEqual({
      "rest.address": "second",
    });
  });

  it("keeps arrays of objects intact as a single value", () => {
    expect(flattenObject({chain: {trustedSetup: [{index: 0}, {index: 1}]}})).toEqual({
      "chain.trustedSetup": [{index: 0}, {index: 1}],
    });
  });

  it("drops empty nested maps and keeps sibling keys", () => {
    expect(flattenObject({rest: {}, network: "hoodi"})).toEqual({network: "hoodi"});
  });

  it("returns an empty object for non-plain input instead of throwing", () => {
    // e.g. an empty or scalar rc config file makes readFile return undefined / a primitive
    expect(flattenObject(undefined as unknown as Record<string, unknown>)).toEqual({});
    expect(flattenObject(null as unknown as Record<string, unknown>)).toEqual({});
    expect(flattenObject("network: hoodi" as unknown as Record<string, unknown>)).toEqual({});
    expect(flattenObject(42 as unknown as Record<string, unknown>)).toEqual({});
  });

  it("skips the __proto__ key and does not pollute Object.prototype", () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "network": "hoodi"}');
    expect(flattenObject(malicious)).toEqual({network: "hoodi"});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps non-plain object values (e.g. Date) as leaves instead of dropping them", () => {
    const genesisTime = new Date("2024-01-01T00:00:00Z");
    expect(flattenObject({chain: {genesisTime}})).toEqual({"chain.genesisTime": genesisTime});
  });
});
