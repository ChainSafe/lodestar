import {describe, expect, it} from "vitest";
import {AllocSource, BufferPool} from "../../../src/util/bufferPool.js";

describe("BufferPool", () => {
  const pool = new BufferPool(100);

  it("should increase length", () => {
    expect(pool.length).toEqual(110);
    using mem = pool.alloc(200, AllocSource.PERSISTENT_CHECKPOINTS_CACHE_STATE);
    if (mem === null) {
      throw Error("Expected non-null mem");
    }
    expect(pool.length).toEqual(220);
  });

  it("should not allow alloc if in use", () => {
    {
      using mem = pool.alloc(20, AllocSource.PERSISTENT_CHECKPOINTS_CACHE_STATE);
      if (mem === null) {
        throw Error("Expected non-null mem");
      }
      // in the same scope we can't allocate again
      expect(pool.alloc(20, AllocSource.PERSISTENT_CHECKPOINTS_CACHE_STATE)).toEqual(null);
    }

    // out of the scope we can allocate again
    expect(pool.alloc(20, AllocSource.PERSISTENT_CHECKPOINTS_CACHE_STATE)).not.toEqual(null);
  });
});
