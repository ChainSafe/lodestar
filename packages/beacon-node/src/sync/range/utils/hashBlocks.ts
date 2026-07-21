import {digest} from "@chainsafe/as-sha256";
import {RootHex, Slot, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {IBlockInput} from "../../../chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";

const ROOT_SIZE = 32;
const SIGNATURE_SIZE = 96;
/** Every block and every payload envelope contributes a fixed-size (root, signature) entry */
const ENTRY_SIZE = ROOT_SIZE + SIGNATURE_SIZE;
/** uint32 LE count of block entries, so the block and envelope sections cannot be confused */
const BLOCK_COUNT_SIZE = 4;

/**
 * Root uniquely identifying a batch attempt (its blocks AND payloads). Used for peer scoring and to
 * compare if two attempts are equivalent.
 *
 * Signatures are part of the id for BOTH blocks and payload envelopes, not just their message roots:
 * a peer serving a correct message with a garbage signature would otherwise produce the same id as
 * the honest attempt and escape scoring in `SyncChain.advanceChain`. Signatures are not verified at
 * download time, only during processChainSegment (block signatures in verifyBlocksSignatures,
 * envelope signatures in importExecutionPayload).
 *
 * Entries are written as raw bytes into a single exactly-sized buffer and digested once, so an
 * `Attempt` retains 32 bytes rather than the ~16 KB a full 32-slot gloas batch would need if the
 * roots and signatures were concatenated as hex. sha256 (not a 64-bit hash) because a peer that
 * could force a collision with the winning attempt would escape peer scoring.
 */
export function hashBlocks(blocks: IBlockInput[], payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null): RootHex {
  // Envelopes without a payload carry no attributable data, so they are skipped entirely. A `null`
  // map and a map whose entries all lack a payload are therefore equivalent, which is intended.
  const envelopes =
    payloadEnvelopes && payloadEnvelopes.size > 0
      ? Array.from(payloadEnvelopes.entries())
          .filter(([, envelope]) => envelope.hasPayloadEnvelope())
          .sort(([slotA], [slotB]) => slotA - slotB)
      : [];

  const buf = Buffer.allocUnsafe(BLOCK_COUNT_SIZE + (blocks.length + envelopes.length) * ENTRY_SIZE);
  buf.writeUInt32LE(blocks.length, 0);
  let offset = BLOCK_COUNT_SIZE;

  for (const block of blocks) {
    buf.set(fromHex(block.blockRootHex), offset);
    offset += ROOT_SIZE;
    buf.set(block.getBlock().signature, offset);
    offset += SIGNATURE_SIZE;
  }

  for (const [, envelope] of envelopes) {
    const signedEnvelope = envelope.getPayloadEnvelope();
    // envelope's root is cached thanks to cachePermanentRootStruct, so this avoids re-hashing
    buf.set(ssz.gloas.ExecutionPayloadEnvelope.hashTreeRoot(signedEnvelope.message), offset);
    offset += ROOT_SIZE;
    buf.set(signedEnvelope.signature, offset);
    offset += SIGNATURE_SIZE;
  }

  return toRootHex(digest(buf));
}
