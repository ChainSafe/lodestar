import crypto from "node:crypto";
import {describe, beforeEach, it, expect} from "vitest";
import {PubkeyIndexMap} from "../../../src/cache/pubkeyCache.js";

describe("PubkeyIndexMap", () => {
  let pubkeyIndexMap: PubkeyIndexMap;

  beforeEach(() => {
    pubkeyIndexMap = new PubkeyIndexMap();
  });

  it("should get Uin8Array key", () => {
    const key = crypto.randomBytes(48);
    pubkeyIndexMap.set(key, 1);
    expect(pubkeyIndexMap.get(key)).toEqual(1);
  });

  it("should get hex key", () => {
    const key = crypto.randomBytes(48);
    pubkeyIndexMap.set(key, 1);
    const hexKey = key.toString("hex");
    expect(pubkeyIndexMap.get(hexKey)).toEqual(1);
    expect(pubkeyIndexMap.get("0x" + hexKey)).toEqual(1);
  });

  it("should not get base64 key", () => {
    const key = crypto.randomBytes(48);
    pubkeyIndexMap.set(key, 1);
    expect(pubkeyIndexMap.get(key.toString("base64"))).toBeUndefined();
  });
});
