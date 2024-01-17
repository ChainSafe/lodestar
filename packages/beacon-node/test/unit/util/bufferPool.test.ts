import {describe, it, expect} from "vitest";
import {BufferPool} from "../../../src/util/bufferPool.js";

describe("BufferPool", () => {
  const pool = new BufferPool(100);

  it("should increase length", () => {
    expect(pool.length).toEqual(110);
    using mem = pool.alloc(200);
    if (mem === null) {
      throw Error("Expected non-null mem");
    }
    expect(pool.length).toEqual(220);
  });

  it("should not allow alloc if in use", () => {
    {
      using mem = pool.alloc(20);
      if (mem === null) {
        throw Error("Expected non-null mem");
      }
      // in the same scope we can't allocate again
      expect(pool.alloc(20)).toEqual(null);
    }

    // out of the scope we can allocate again
    expect(pool.alloc(20)).not.toEqual(null);
  });
});
