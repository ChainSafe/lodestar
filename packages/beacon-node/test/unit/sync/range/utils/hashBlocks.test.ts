import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBlockInput} from "../../../../../src/chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {hashBlocks} from "../../../../../src/sync/range/utils/hashBlocks.js";

describe("sync / range / utils / hashBlocks", () => {
  // Roots must be a full 32 bytes: hashBlocks writes them into an allocUnsafe buffer at a fixed
  // stride, so a short root would leave uninitialized memory and a non-deterministic id.
  function rootHex(seed: number): string {
    return toRootHex(Buffer.alloc(32, seed));
  }

  // Lightweight stubs: hashBlocks only reads blockRootHex / hasBlock / getBlock().signature on blocks
  // and hasPayloadEnvelope / getPayloadEnvelope on envelopes.
  function fakeBlock(blockRootHex: string, signature = Buffer.alloc(96, 0)): IBlockInput {
    return {
      blockRootHex,
      hasBlock: () => true,
      getBlock: () => ({signature}),
    } as unknown as IBlockInput;
  }

  // `builderIndex` distinguishes envelopes; ExecutionPayloadEnvelope has no slot field, the slot only
  // exists as the Map key that hashBlocks sorts on.
  function fakeEnvelope(
    builderIndex: number,
    hasPayload = true,
    signature = Buffer.alloc(96, 0)
  ): PayloadEnvelopeInput {
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.builderIndex = builderIndex;
    signedEnvelope.signature = signature;
    return {
      hasPayloadEnvelope: () => hasPayload,
      getPayloadEnvelope: () => signedEnvelope,
    } as unknown as PayloadEnvelopeInput;
  }

  // The id is retained on every Attempt, so it must not grow with batch size. Concatenating roots
  // and signatures instead of digesting them would be ~16 KB for a full 32-slot gloas batch.
  it("returns a fixed-size root regardless of batch size", () => {
    const one = hashBlocks([fakeBlock(rootHex(0xaa))], null);
    const manyBlocks = Array.from({length: 32}, (_, i) => fakeBlock(rootHex(i)));
    const manyEnvelopes = new Map(Array.from({length: 32}, (_, i) => [i, fakeEnvelope(i)]));
    const many = hashBlocks(manyBlocks, manyEnvelopes);

    expect(one).toMatch(/^0x[0-9a-f]{64}$/);
    expect(many).toMatch(/^0x[0-9a-f]{64}$/);
    expect(many.length).toBe(one.length);
  });

  it("identical blocks and signatures produce identical ids", () => {
    const blocks = [fakeBlock(rootHex(0xaa)), fakeBlock(rootHex(0xbb))];
    const same = [fakeBlock(rootHex(0xaa)), fakeBlock(rootHex(0xbb))];

    expect(hashBlocks(blocks, null)).toBe(hashBlocks(same, null));
  });

  // Regression: blockRootHex is the root of block.message, so a peer serving the correct message with
  // a garbage signature would otherwise collide with the honest attempt and escape peer scoring.
  it("identical block messages with different signatures produce different ids", () => {
    const honest = [fakeBlock(rootHex(0xaa), Buffer.alloc(96, 0))];
    const forgedSignature = [fakeBlock(rootHex(0xaa), Buffer.alloc(96, 1))];

    expect(hashBlocks(honest, null)).not.toBe(hashBlocks(forgedSignature, null));
  });

  it("different block roots produce different ids", () => {
    expect(hashBlocks([fakeBlock(rootHex(0xaa))], null)).not.toBe(hashBlocks([fakeBlock(rootHex(0xbb))], null));
  });

  // Failing loudly beats substituting a placeholder signature: zeros would make this collide with a
  // real block whose signature is all zeros, and writing nothing would leave allocUnsafe garbage.
  // Unreachable in practice — startProcessing() requires every block to be present.
  it("throws when a block is not available rather than producing an ambiguous id", () => {
    const withoutBlock = {
      blockRootHex: rootHex(0xaa),
      hasBlock: () => false,
      getBlock: () => {
        throw Error("MISSING_BLOCK");
      },
    } as unknown as IBlockInput;

    expect(() => hashBlocks([withoutBlock], null)).toThrow();
  });

  it("envelope ordering is slot-stable regardless of Map insertion order", () => {
    const blocks = [fakeBlock(rootHex(0xaa))];
    // distinct envelopes, so a wrong sort would actually change the id
    const ascending = new Map([
      [1, fakeEnvelope(11)],
      [2, fakeEnvelope(22)],
    ]);
    const descending = new Map([
      [2, fakeEnvelope(22)],
      [1, fakeEnvelope(11)],
    ]);

    expect(hashBlocks(blocks, ascending)).toBe(hashBlocks(blocks, descending));
    // sanity: the two envelopes really are different, so the assertion above is not vacuous
    expect(hashBlocks(blocks, new Map([[1, fakeEnvelope(11)]]))).not.toBe(
      hashBlocks(blocks, new Map([[1, fakeEnvelope(22)]]))
    );
  });

  it("different envelopes produce different ids", () => {
    const blocks = [fakeBlock(rootHex(0xaa))];
    const one = new Map([[1, fakeEnvelope(11)]]);
    const other = new Map([[1, fakeEnvelope(22)]]);

    expect(hashBlocks(blocks, one)).not.toBe(hashBlocks(blocks, other));
  });

  // Same hole as the block-side signature case: the envelope id is the root of the *message*, so
  // without folding in the signature a forged-signature envelope collides with the honest one and
  // escapes peer scoring, even though it fails with PayloadErrorCode.INVALID_SIGNATURE.
  it("identical envelope messages with different signatures produce different ids", () => {
    const blocks = [fakeBlock(rootHex(0xaa))];
    const honest = new Map([[1, fakeEnvelope(11, true, Buffer.alloc(96, 0))]]);
    const forgedSignature = new Map([[1, fakeEnvelope(11, true, Buffer.alloc(96, 1))]]);

    expect(hashBlocks(blocks, honest)).not.toBe(hashBlocks(blocks, forgedSignature));
  });

  // The id is built in an allocUnsafe buffer, so every allocated byte must be written. A batch where
  // only some blocks carry a payload is the case most likely to leave an unwritten tail; if it did,
  // the id would vary run to run as the Buffer pool changes underneath it.
  it("is deterministic when only some blocks have a payload envelope", () => {
    const blocks = Array.from({length: 32}, (_, i) => fakeBlock(rootHex(i)));
    const build = (): Map<number, PayloadEnvelopeInput> =>
      new Map(Array.from({length: 32}, (_, i) => [i, fakeEnvelope(i, i % 7 === 0)]));

    const ids = new Set<string>();
    for (let round = 0; round < 50; round++) {
      // dirty the Buffer pool between runs so unwritten bytes would differ
      Buffer.allocUnsafe(64 * 1024).fill(round % 251);
      ids.add(hashBlocks(blocks, build()));
    }

    expect(ids.size).toBe(1);
  });

  // Intended equivalence: an envelope without a payload carries no attributable data
  it("null envelopes and envelopes that all lack a payload produce the same id", () => {
    const blocks = [fakeBlock(rootHex(0xaa))];
    const noPayloads = new Map([
      [1, fakeEnvelope(11, false)],
      [2, fakeEnvelope(22, false)],
    ]);

    expect(hashBlocks(blocks, noPayloads)).toBe(hashBlocks(blocks, null));
  });

  it("does not throw on an empty blocks array", () => {
    expect(() => hashBlocks([], null)).not.toThrow();
    expect(hashBlocks([], null)).not.toBe(hashBlocks([fakeBlock(rootHex(0xaa))], null));
  });
});
