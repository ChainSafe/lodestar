import {describe, expect, it} from "vitest";
import {SerializedList} from "@chainsafe/ssz";
import {ForkName, ForkPostBellatrix, ForkSeq} from "@lodestar/params";
import {ExecutionPayload, ExecutionRequests, capella, deneb, electra, gloas, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {computeExecutionBlockHash, computeOrderedTrieRoot} from "../../../../src/execution/engine/blockHash.js";
import {ExecutionPayloadRpc, parseExecutionPayload} from "../../../../src/execution/engine/types.js";

const PARENT_BEACON_BLOCK_ROOT = new Uint8Array(32).fill(0x66);

/**
 * Deterministic payload with enough transactions for branch, extension and hashed trie nodes, RLP long-form
 * items, and transaction indices that encode to 2-byte keys.
 */
function buildPayload(fork: ForkPostBellatrix): {
  payload: ExecutionPayload;
  executionRequests: ExecutionRequests | null;
} {
  const forkSeq = ForkSeq[fork];
  const payload = ssz[fork].ExecutionPayload.defaultValue();
  payload.parentHash = new Uint8Array(32).fill(0x11);
  payload.feeRecipient = new Uint8Array(20).fill(0x22);
  payload.stateRoot = new Uint8Array(32).fill(0x33);
  payload.receiptsRoot = new Uint8Array(32).fill(0x44);
  payload.logsBloom = Uint8Array.from({length: 256}, (_, i) => i);
  payload.prevRandao = new Uint8Array(32).fill(0x55);
  payload.blockNumber = 21_000_000;
  payload.gasLimit = 36_000_000;
  payload.gasUsed = 12_345_678;
  payload.timestamp = 1_750_000_000;
  payload.extraData = new TextEncoder().encode("lodestar");
  payload.baseFeePerGas = BigInt(1_234_567_890_123);

  const transactions: Uint8Array[] = [];
  for (let i = 0; i < 200; i++) {
    const tx = Uint8Array.from({length: 1 + (i % 9) * 11}, (_, j) => (i * 31 + j * 7) & 0xff);
    tx[0] = 0x02;
    transactions.push(tx);
  }
  payload.transactions = SerializedList.fromArray(transactions);

  if (forkSeq >= ForkSeq.capella) {
    (payload as capella.ExecutionPayload).withdrawals = Array.from({length: 16}, (_, i) => ({
      index: 1_000_000 + i,
      validatorIndex: 500_000 + i * 3,
      address: new Uint8Array(20).fill(0x70 + i),
      amount: BigInt(17_000_000 + i * 1_000),
    }));
  }

  if (forkSeq >= ForkSeq.deneb) {
    (payload as deneb.ExecutionPayload).blobGasUsed = BigInt(393_216);
    (payload as deneb.ExecutionPayload).excessBlobGas = BigInt(1_234);
  }

  if (forkSeq >= ForkSeq.gloas) {
    (payload as gloas.ExecutionPayload).blockAccessList = Uint8Array.from([0xc3, 0x01, 0x02, 0x03]);
    (payload as gloas.ExecutionPayload).slotNumber = 13_000_000;
  }

  let executionRequests: ExecutionRequests | null = null;
  if (forkSeq >= ForkSeq.electra) {
    const requests: electra.ExecutionRequests = ssz.electra.ExecutionRequests.defaultValue();
    requests.deposits.push(
      {...ssz.electra.DepositRequest.defaultValue(), amount: 32_000_000_000, index: BigInt(7)},
      ssz.electra.DepositRequest.defaultValue()
    );
    requests.withdrawals.push(ssz.electra.WithdrawalRequest.defaultValue());
    requests.consolidations.push(ssz.electra.ConsolidationRequest.defaultValue());
    executionRequests = requests;
  }
  if (forkSeq >= ForkSeq.gloas) {
    const requests = {...ssz.gloas.ExecutionRequests.defaultValue(), ...executionRequests};
    requests.builderDeposits.push(ssz.gloas.BuilderDepositRequest.defaultValue());
    requests.builderExits.push(ssz.gloas.BuilderExitRequest.defaultValue());
    executionRequests = requests;
  }

  return {payload, executionRequests};
}

describe("execution / engine / blockHash", () => {
  it("computeOrderedTrieRoot of no items is the empty trie root", () => {
    expect(toHex(computeOrderedTrieRoot([]))).toBe(
      "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421"
    );
  });

  // Two items give a branch of two 1-nibble leaves whose RLP is `itemLength + 3` bytes, so 29 is the
  // first length where a leaf must be referenced by hash instead of embedded. Roots computed with py-trie.
  const trieBoundaryRoots: [number, string][] = [
    [28, "0x82e166a9e47bc8433e181fb2138bffdc162e41a762c2d660ef45c697bfb38db6"],
    [29, "0x0c42afb5b79fcf46c778821c0cb377f861d4294e525a32b6dc0fc47c0f6d2633"],
    [30, "0x5f1cb94549b53525083956ff42b869d3f7ede982e74d3011d6ab0c1a52acc3e2"],
  ];
  for (const [itemLength, expectedRoot] of trieBoundaryRoots) {
    it(`computeOrderedTrieRoot of two ${itemLength}-byte items`, () => {
      const items = [0, 1].map((seed) =>
        Uint8Array.from({length: itemLength}, (_, j) => (j === 0 ? 0x02 : (seed * 31 + j * 7) & 0xff))
      );
      expect(toHex(computeOrderedTrieRoot(items))).toBe(expectedRoot);
    });
  }

  it("computeExecutionBlockHash matches the EL hash of a bellatrix payload", () => {
    // engine_getPayloadV1 example from the execution-apis spec
    const rpc: ExecutionPayloadRpc = {
      blockHash: "0xb084c10440f05f5a23a55d1d7ebcb1b3892935fb56f23cdc9a7f42c348eed174",
      parentHash: "0xa0513a503d5bd6e89a144c3268e5b7e9da9dbf63df125a360e3950a7d0d67131",
      feeRecipient: "0xa94f5374fce5edbc8e2a8697c15331677e6ebf0b",
      stateRoot: "0xca3149fa9e37db08d1cd49c9061db1002ef1cd58db2210f2115c8c989b2bdf45",
      receiptsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      logsBloom: `0x${"00".repeat(256)}`,
      prevRandao: "0x0000000000000000000000000000000000000000000000000000000000000000",
      blockNumber: "0x1",
      gasLimit: "0x989680",
      gasUsed: "0x0",
      timestamp: "0x5",
      extraData: "0x",
      baseFeePerGas: "0x7",
      transactions: [],
    };
    const {executionPayload} = parseExecutionPayload(ForkName.bellatrix, rpc);

    expect(toHex(computeExecutionBlockHash(ForkName.bellatrix, executionPayload, null, null))).toBe(rpc.blockHash);
  });

  // Expected hashes computed with py-rlp, py-trie and eth-hash, using the header layout of the
  // consensus-specs pyspec helper compute_el_header_block_hash
  const expectedHashes: [ForkPostBellatrix, string][] = [
    [ForkName.bellatrix, "0x33ae12e22cfee539420823b73464325df4d86120febe6eab2b91df89bf9247da"],
    [ForkName.capella, "0xb6f59257a3ce673b367c7ff2b40744e840d85ce6416e8710502242ed980a324c"],
    [ForkName.deneb, "0xe4719330bc2498bf325ca88bd3a80baa9c250a9bbff7390c54d4cb68ffec3d68"],
    [ForkName.electra, "0x1941d61f1d59dc8efee161dfe1810bde75996f499087dccccf44bf34e432ce45"],
    [ForkName.gloas, "0x0384d7d2f4f88f1ac3927ae9059a08e063e6a5cf7a9088572b52a693ac71ce5f"],
  ];

  for (const [fork, expectedHash] of expectedHashes) {
    it(`computeExecutionBlockHash for ${fork}`, () => {
      const {payload, executionRequests} = buildPayload(fork);
      const parentBeaconBlockRoot = ForkSeq[fork] >= ForkSeq.deneb ? PARENT_BEACON_BLOCK_ROOT : null;

      expect(toHex(computeExecutionBlockHash(fork, payload, parentBeaconBlockRoot, executionRequests))).toBe(
        expectedHash
      );
    });
  }
});
