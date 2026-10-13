import {describe, expect, it} from "vitest";
import {SerializedCache} from "../../../src/util/serializedCache.js";

describe("SerializedCache", () => {
  it("retains bytes when the same entry is registered again", () => {
    const cache = new SerializedCache({cacheDeserialized: true});
    const object = {slot: 1};
    const bytes = new Uint8Array([1]);
    cache.set(object, bytes);
    cache.set(object, bytes);
    expect(cache.get(object)).toBe(bytes);
    expect(cache.getDeserialized(bytes)).toBe(object);
  });

  it("replaces bytes for an object", () => {
    const cache = new SerializedCache({cacheDeserialized: true});
    const object = {slot: 1};
    const oldBytes = new Uint8Array([1]);
    const newBytes = new Uint8Array([2]);
    cache.set(object, oldBytes);
    cache.set(object, newBytes);
    expect(cache.get(object)).toBe(newBytes);
    expect(cache.getDeserialized(oldBytes)).toBeUndefined();
    expect(cache.getDeserialized(newBytes)).toBe(object);
  });

  it("does not delete a replacement object when the previous object is evicted", () => {
    const cache = new SerializedCache({cacheDeserialized: true});
    const oldObject = {slot: 1};
    const newObject = {slot: 1};
    const bytes = new Uint8Array([1]);
    cache.set(oldObject, bytes);
    cache.set(newObject, bytes);
    expect(cache.get(oldObject)).toBe(bytes);
    cache.delete([oldObject]);
    expect(cache.get(oldObject)).toBeUndefined();
    expect(cache.get(newObject)).toBe(bytes);
    expect(cache.getDeserialized(bytes)).toBe(newObject);
  });

  it("deletes objects without evicting unrelated entries", () => {
    const cache = new SerializedCache({cacheDeserialized: true});
    const block = {slot: 1};
    const sidecar = {index: 0};
    const blockBytes = new Uint8Array([1]);
    const sidecarBytes = new Uint8Array([2]);
    cache.set(block, blockBytes);
    cache.set(sidecar, sidecarBytes);
    cache.delete([block]);
    cache.delete([block]);
    expect(cache.get(block)).toBeUndefined();
    expect(cache.get(sidecar)).toBe(sidecarBytes);
    expect(cache.getDeserialized(blockBytes)).toBeUndefined();
    expect(cache.getDeserialized(sidecarBytes)).toBe(sidecar);
  });

  it("keeps a replacement reverse entry when the previous object changes bytes", () => {
    const cache = new SerializedCache({cacheDeserialized: true});
    const oldObject = {slot: 1};
    const newObject = {slot: 1};
    const oldBytes = new Uint8Array([1]);
    const newBytes = new Uint8Array([2]);
    cache.set(oldObject, oldBytes);
    cache.set(newObject, oldBytes);
    cache.set(oldObject, newBytes);
    expect(cache.getDeserialized(oldBytes)).toBe(newObject);
    expect(cache.getDeserialized(newBytes)).toBe(oldObject);
  });

  it("only reuses the exact byte array", () => {
    const cache = new SerializedCache({cacheDeserialized: true});
    const bytes = new Uint8Array([1]);
    cache.set({slot: 1}, bytes);
    expect(cache.getDeserialized(Uint8Array.from(bytes))).toBeUndefined();
  });

  it("retains serialized bytes without caching decoded objects by default", () => {
    const cache = new SerializedCache();
    const object = {slot: 1};
    const bytes = new Uint8Array([1]);
    cache.set(object, bytes);
    expect(cache.get(object)).toBe(bytes);
    expect(cache.getDeserialized(bytes)).toBeUndefined();
  });
});
