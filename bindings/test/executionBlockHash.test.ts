import {describe, expect, it} from "vitest";
import {computeExecutionBlockHash, computeTransactionsRoot} from "../src/execution-block-hash.js";

const BELLATRIX = 2;
const DENEB = 4;
const BELLATRIX_PAYLOAD_FIXED_SIZE = 508;

/** SSZ bellatrix `ExecutionPayload` without extra data or transactions */
function emptyBellatrixPayload(): Uint8Array {
  const payload = new Uint8Array(BELLATRIX_PAYLOAD_FIXED_SIZE);
  const view = new DataView(payload.buffer);
  // extra_data and transactions offsets
  view.setUint32(436, BELLATRIX_PAYLOAD_FIXED_SIZE, true);
  view.setUint32(504, BELLATRIX_PAYLOAD_FIXED_SIZE, true);
  return payload;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("executionBlockHash", () => {
  it("computeTransactionsRoot of no transactions is the empty trie root", () => {
    expect(toHex(computeTransactionsRoot(new Uint8Array(0)))).toBe(
      "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"
    );
  });

  it("computeTransactionsRoot of two transactions", () => {
    // Root computed with py-trie, see src/execution_block_hash/root_test.zig
    const length = 29;
    const transactions = new Uint8Array(8 + 2 * length);
    const view = new DataView(transactions.buffer);
    for (let seed = 0; seed < 2; seed++) {
      const offset = 8 + seed * length;
      view.setUint32(4 * seed, offset, true);
      for (let j = 0; j < length; j++) {
        transactions[offset + j] = j === 0 ? 0x02 : (seed * 31 + j * 7) & 0xff;
      }
    }

    expect(toHex(computeTransactionsRoot(transactions))).toBe(
      "0c42afb5b79fcf46c778821c0cb377f861d4294e525a32b6dc0fc47c0f6d2633"
    );
  });

  it("computeTransactionsRoot throws on an empty transaction", () => {
    const transactions = new Uint8Array(4);
    new DataView(transactions.buffer).setUint32(0, 4, true);

    expect(() => computeTransactionsRoot(transactions)).toThrow("EmptyTransaction");
  });

  it("computeExecutionBlockHash returns a 32-byte hash", () => {
    expect(computeExecutionBlockHash(BELLATRIX, emptyBellatrixPayload())).toHaveLength(32);
  });

  it("computeExecutionBlockHash throws on invalid arguments", () => {
    const payload = emptyBellatrixPayload();

    expect(() => computeExecutionBlockHash(1, payload)).toThrow("InvalidFork");
    expect(() => computeExecutionBlockHash(BELLATRIX, payload.subarray(1))).toThrow("InvalidPayload");
    expect(() => computeExecutionBlockHash(DENEB, payload)).toThrow("InvalidPayload");
    expect(() => computeExecutionBlockHash(BELLATRIX, payload, new Uint8Array(31))).toThrow(
      "InvalidParentBeaconBlockRoot"
    );
  });
});
