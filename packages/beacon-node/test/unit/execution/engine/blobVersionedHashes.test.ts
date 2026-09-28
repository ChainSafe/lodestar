import {Input, RLP} from "@ethereumjs/rlp";
import {describe, expect, it} from "vitest";
import {isValidBlobVersionedHashes} from "../../../../src/execution/engine/blobVersionedHashes.js";

describe("isValidBlobVersionedHashes", () => {
  const first = new Uint8Array(32).fill(1);
  const second = new Uint8Array(32).fill(2);

  function blobTransaction(hashes: Input): Uint8Array {
    return new Uint8Array([
      0x03,
      ...RLP.encode([1, 0, 1, 1, 21000, new Uint8Array(20), 0, new Uint8Array(), [], 1, hashes, 0, 1, 1]),
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
