import {Input, NestedUint8Array, RLP} from "@ethereumjs/rlp";
import {describe, expect, it} from "vitest";
import {byteArrayEquals} from "@lodestar/utils";
import {isValidBlobVersionedHashes} from "../../../../src/execution/engine/blobVersionedHashes.js";

describe("isValidBlobVersionedHashes", () => {
  const first = new Uint8Array(32).fill(1);
  const second = new Uint8Array(32).fill(2);

  function blobTransaction(hashes: Input, data = new Uint8Array()): Uint8Array {
    return new Uint8Array([
      0x03,
      ...RLP.encode([1, 0, 1, 1, 21000, new Uint8Array(20), 0, data, [], 1, hashes, 0, 1, 1]),
    ]);
  }

  it("accepts a payload with no blob transactions and no commitments", () => {
    expect(isValidBlobVersionedHashes([], [])).toBe(true);
    expect(isValidBlobVersionedHashes([new Uint8Array([0xc0]), new Uint8Array([0x02, 0xc0])], [])).toBe(true);
  });

  it("matches hashes across transactions in order, including duplicates", () => {
    const transactions = [blobTransaction([first, first]), new Uint8Array([0x02, 0xc0]), blobTransaction([second])];
    expect(isValidBlobVersionedHashes(transactions, [first, first, second])).toBe(true);
  });

  it.each([0, 1, 55, 56, 255, 256, 65535, 65536])("skips a data field of %s bytes", (length) => {
    for (const count of [0, 1, 2, 16]) {
      const hashes = Array.from({length: count}, (_, i) => new Uint8Array(32).fill(i));
      const transaction = blobTransaction(hashes, new Uint8Array(length).fill(0x80));
      expect(isValidBlobVersionedHashes([transaction], hashes), `${length} data bytes, ${count} hashes`).toBe(true);
      expect(isValidBlobVersionedHashes([transaction], [...hashes, first]), `${length} data bytes, extra hash`).toBe(
        false
      );
    }
  });

  it("leaves unrelated nested fields to the EL without recursively decoding them", () => {
    let nested: Uint8Array = new Uint8Array([0xc0]);
    for (let i = 0; i < 5000; i++) {
      nested = RLP.encode(nested);
      nested[0] += 0x40;
    }
    const before = RLP.encode([1, 0, 1, 1, 21000, new Uint8Array(20), 0, new Uint8Array()]);
    const after = RLP.encode([1, [first], 0, 1, 1]);
    // Both fragments have a one-byte list header; wrap their contents and the opaque access list.
    const fields = new Uint8Array([...before.subarray(1), ...nested, ...after.subarray(1)]);
    const encoded = RLP.encode(fields);
    encoded[0] += 0x40;
    expect(isValidBlobVersionedHashes([new Uint8Array([0x03, ...encoded])], [first])).toBe(true);
  });

  it("agrees with a full RLP decoder on mutated but decodable transactions", () => {
    const original = blobTransaction([first, second]);
    let checked = 0;
    for (let offset = 1; offset < original.length; offset++) {
      for (const byte of [0, 0x7f, 0x80, 0xa0, 0xc0, 0xf8, 0xff]) {
        const transaction = original.slice();
        transaction[offset] = byte;
        let fields: Uint8Array | NestedUint8Array;
        try {
          fields = RLP.decode(transaction.subarray(1));
        } catch {
          continue;
        }
        if (!Array.isArray(fields) || fields.length !== 14) continue;
        const hashes = fields[10];
        const matches =
          Array.isArray(hashes) &&
          hashes.length === 2 &&
          hashes[0] instanceof Uint8Array &&
          byteArrayEquals(hashes[0], first) &&
          hashes[1] instanceof Uint8Array &&
          byteArrayEquals(hashes[1], second);
        expect(isValidBlobVersionedHashes([transaction], [first, second]), `offset=${offset} byte=${byte}`).toBe(
          matches
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it.each([
    {name: "missing commitments", expected: []},
    {name: "too few commitments", expected: [first]},
    {name: "too many commitments", expected: [first, second, second]},
    {name: "wrong order", expected: [second, first]},
    {name: "wrong hash", expected: [first, first]},
  ])("rejects $name", ({expected}) => {
    expect(isValidBlobVersionedHashes([blobTransaction([first, second])], expected)).toBe(false);
  });

  it("rejects commitments without blob transactions", () => {
    expect(isValidBlobVersionedHashes([], [first])).toBe(false);
  });

  it.each([
    {name: "empty transaction", transaction: new Uint8Array()},
    {name: "missing RLP", transaction: new Uint8Array([0x03])},
    {name: "wrong number of fields", transaction: new Uint8Array([0x03, 0xc0])},
    {
      name: "oversized declared length",
      transaction: new Uint8Array([0x03, 0xff, 255, 255, 255, 255, 255, 255, 255, 255]),
    },
    {name: "nonminimal length", transaction: new Uint8Array([0x03, 0xf8, 0x00])},
    {name: "truncated RLP", transaction: blobTransaction([first]).subarray(0, -1)},
    {name: "trailing bytes", transaction: new Uint8Array([...blobTransaction([first]), 0])},
    {name: "hashes encoded as bytes", transaction: blobTransaction(first)},
    {name: "nested hashes", transaction: blobTransaction([[first]])},
    {name: "short hash", transaction: blobTransaction([new Uint8Array(31)])},
    {name: "long hash", transaction: blobTransaction([new Uint8Array(33)])},
    {name: "mempool wrapper", transaction: new Uint8Array([0x03, ...RLP.encode([[], [], [], []])])},
  ])("rejects $name", ({transaction}) => {
    expect(isValidBlobVersionedHashes([transaction], [first])).toBe(false);
  });
});
