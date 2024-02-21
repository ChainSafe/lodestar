import {describe, it, expect, beforeEach} from "vitest";
import {RingBuffer} from "../../../src/util/ringBuffer.js";

describe("RingBuffer", () => {
  let buffer: RingBuffer<Uint8Array>;
  const bufferLength = 1000 * 1024;

  beforeEach(() => {
    buffer = new RingBuffer<Uint8Array>(
      new SharedArrayBuffer(bufferLength),
      new SharedArrayBuffer(8),
      (object: Uint8Array) => object,
      (data: Uint8Array) => data
    );
  });

  it("should add an item correctly", () => {
    const item = new Uint8Array(1020);
    const written = buffer.writeObject(item);
    expect(written).toBe(true);
    expect(buffer.unreadBytes).toBe(1024);
  });

  it("should add items correctly", () => {
    const item = new Uint8Array(1020);
    // fill the buffer entirely
    for (let i = 0; i < 999; i++) {
      const written = buffer.writeObject(item);
      expect(written).toBe(true);
    }
    expect(buffer.unreadBytes).toBe(1024 * 999);
    // now it should be full
    const written = buffer.writeObject(item);
    expect(written).toBe(false);
  });

  it("should read an item correctly", () => {
    expect(buffer.readObject()).toBe(undefined);

    const item = Uint8Array.from([1, 2, 3, 4]);
    buffer.writeObject(item);

    expect(buffer.readObject()).toEqual(item);
    expect(buffer.unreadBytes).toBe(0);
  });

  it("should write an item that wraps around the buffer", () => {
    const item = new Uint8Array(1020);
    // fill the buffer entirely
    for (let i = 0; i < 999; i++) {
      const written = buffer.writeObject(item);
      expect(written).toBe(true);
    }
    expect(buffer.unreadBytes).toBe(1024 * 999);
    // now it should be full
    const written = buffer.writeObject(item);
    expect(written).toBe(false);
    // read one item
    expect(buffer.readObject()).toEqual(item);
    // write one item
    item[0] = 5;
    const written2 = buffer.writeObject(item);
    expect(written2).toBe(true);

    // read all but last items
    for (let i = 0; i < 998; i++) {
      buffer.readObject();
    }
    expect(buffer.readObject()).toEqual(item);
  });

  it("should wrap around the buffer", () => {
    for (let i = 0; i < 1000000; i++) {
      const written = buffer.writeObject(Buffer.alloc(Math.floor(Math.random() * 1024)));
      expect(written).toBe(true);
      buffer.readObject();
    }
    expect(buffer.unreadBytes).toBe(0);
  });
});
