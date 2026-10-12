import {describe, expect, it} from "vitest";
import {SerializedCache} from "../../../src/util/serializedCache.js";

describe("SerializedCache", () => {
  it("retains both associations when the same entry is registered again", () => {
    const cache = new SerializedCache();
    const object = {slot: 1};
    const bytes = new Uint8Array([1]);
    cache.set(object, bytes);
    cache.set(object, bytes);
    expect(cache.get(object)).toBe(bytes);
    expect(cache.getDeserialized(bytes)).toBe(object);
    expect(cache.getDeserialized(Uint8Array.from(bytes))).toBeUndefined();
  });

  it("removes the old reverse association when an object's bytes change", () => {
    const cache = new SerializedCache();
    const object = {slot: 1};
    const oldBytes = new Uint8Array([1]);
    const newBytes = new Uint8Array([2]);
    cache.set(object, oldBytes);
    cache.set(object, newBytes);
    expect(cache.getDeserialized(oldBytes)).toBeUndefined();
    expect(cache.get(object)).toBe(newBytes);
    expect(cache.getDeserialized(newBytes)).toBe(object);
  });

  it("does not delete a replacement object when the previous object is evicted", () => {
    const cache = new SerializedCache();
    const oldObject = {slot: 1};
    const newObject = {slot: 1};
    const bytes = new Uint8Array([1]);
    cache.set(oldObject, bytes);
    cache.set(newObject, bytes);
    cache.delete([oldObject]);
    expect(cache.get(oldObject)).toBeUndefined();
    expect(cache.get(newObject)).toBe(bytes);
    expect(cache.getDeserialized(bytes)).toBe(newObject);
  });

  it("deletes both associations without evicting unrelated entries", () => {
    const cache = new SerializedCache();
    const block = {slot: 1};
    const sidecar = {index: 0};
    const blockBytes = new Uint8Array([1]);
    const sidecarBytes = new Uint8Array([2]);
    cache.set(block, blockBytes);
    cache.set(sidecar, sidecarBytes);
    cache.delete([block]);
    cache.delete([block]);
    expect(cache.get(block)).toBeUndefined();
    expect(cache.getDeserialized(blockBytes)).toBeUndefined();
    expect(cache.get(sidecar)).toBe(sidecarBytes);
    expect(cache.getDeserialized(sidecarBytes)).toBe(sidecar);
  });
});
