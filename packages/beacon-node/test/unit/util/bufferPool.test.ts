import {describe, it, expect} from "vitest";
import {BufferPool} from "../../../src/util/bufferPool.js";

describe("BufferPool", () => {
  const pool = new BufferPool(100);

  it("should increase length", () => {
    expect(pool.length).toEqual(110);
    const mem = pool.alloc(200);
    if (mem === null) {
      throw Error("Expected non-null mem");
    }
    expect(pool.length).toEqual(220);
    pool.free(mem.key);
  });

  it("should not allow alloc if in use", () => {
    const mem = pool.alloc(20);
    if (mem === null) {
      throw Error("Expected non-null mem");
    }
    expect(pool.alloc(20)).toEqual(null);
    pool.free(mem.key);
  });
});
