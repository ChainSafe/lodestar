import {RootHex, Slot, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBlockInput} from "../../../chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";

/**
 * String to uniquely identify a batch attempt (its blocks AND payloads). Used for peer scoring and to
 * compare if two attempts are equivalent.
 */
export function hashBlocks(blocks: IBlockInput[], payloadEnvelopes: Map<Slot, PayloadEnvelopeInput> | null): RootHex {
  // blocks are stored slot-sorted (see Batch.downloadingSuccess)
  const blockRoots = blocks.map((block) => block.blockRootHex).join(",");

  let envelopeRoots = "";
  if (payloadEnvelopes && payloadEnvelopes.size > 0) {
    envelopeRoots = Array.from(payloadEnvelopes.entries())
      .filter(([, envelope]) => envelope.hasPayloadEnvelope())
      .sort(([slotA], [slotB]) => slotA - slotB)
      .map(([, envelope]) =>
        toRootHex(ssz.gloas.ExecutionPayloadEnvelope.hashTreeRoot(envelope.getPayloadEnvelope().message))
      )
      .join(",");
  }

  return `${blockRoots}|${envelopeRoots}`;
}
