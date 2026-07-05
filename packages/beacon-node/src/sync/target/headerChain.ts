import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, bellatrix, deneb, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {HeaderChainElement} from "./types.js";

/**
 * Build a header-chain element from a (root-verified) block.
 *
 * The EL block hashes and blob count live in different places by fork:
 *   - gloas+: in the execution-payload bid (`signedExecutionPayloadBid`).
 *   - bellatrix..fulu: in the inline `executionPayload`; blob commitments are on the block body
 *     from deneb onward.
 *
 * TargetSync operates on fulu+ blocks, so a pre-bellatrix block (no execution payload, no EL
 * hashes to carry) can never reach here — it throws rather than fabricate a zero-hash element.
 */
export function toHeaderChainElement(
  config: ChainForkConfig,
  block: SignedBeaconBlock,
  root: RootHex
): HeaderChainElement {
  const slot = block.message.slot;
  const forkSeq = config.getForkSeq(slot);
  const body = block.message.body;
  const parentRoot = toRootHex(block.message.parentRoot);

  if (forkSeq >= ForkSeq.gloas) {
    const bid = (body as gloas.BeaconBlockBody).signedExecutionPayloadBid.message;
    return {
      root,
      parentRoot,
      slot,
      blockHash: toRootHex(bid.blockHash),
      parentBlockHash: toRootHex(bid.parentBlockHash),
      blobCount: bid.blobKzgCommitments.length,
    };
  }

  if (forkSeq >= ForkSeq.bellatrix) {
    const payload = (body as bellatrix.BeaconBlockBody).executionPayload;
    return {
      root,
      parentRoot,
      slot,
      blockHash: toRootHex(payload.blockHash),
      parentBlockHash: toRootHex(payload.parentHash),
      blobCount: forkSeq >= ForkSeq.deneb ? (body as deneb.BeaconBlockBody).blobKzgCommitments.length : 0,
    };
  }

  throw Error(`toHeaderChainElement: unexpected pre-bellatrix block at slot ${slot}`);
}
