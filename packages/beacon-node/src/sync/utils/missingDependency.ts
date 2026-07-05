import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {RootHex, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {IBeaconChain} from "../../chain/interface.js";

/**
 * Which dependency a locally-complete block is blocked on.
 */
export type MissingDependency =
  | {kind: "ready"}
  | {kind: "block" | "parentBlock" | "parentPayload"; rootHex: RootHex}
  | {kind: "invalidParentPayload"; parentRootHex: RootHex; parentBlockHashHex: RootHex};

export type MissingDependencyDeps = {
  config: ChainForkConfig;
  chain: Pick<IBeaconChain, "forkChoice" | "seenPayloadEnvelopeInputCache">;
};

/**
 * Post-gloas, a locally complete block can still be blocked on its parent's execution-payload
 * lineage. Distinguish which dependency is missing so the scheduler can enqueue the right
 * follow-up work.
 *
 * Reads only `chain.forkChoice` + `chain.seenPayloadEnvelopeInputCache`. Shared by
 * UnknownBlockSync and TargetSync — the single source of truth for gloas payload-lineage
 * classification, so a spec change lands in one place rather than diverging across two engines.
 */
export function classifyMissingDependency(
  {config, chain}: MissingDependencyDeps,
  blockInput: IBlockInput
): MissingDependency {
  const parentRootHex = blockInput.parentRootHex;
  if (!chain.forkChoice.hasBlockHex(parentRootHex)) {
    return {kind: "parentBlock", rootHex: parentRootHex};
  }

  if (!blockInput.hasBlock()) {
    return {kind: "block", rootHex: blockInput.blockRootHex};
  }

  if (config.getForkSeq(blockInput.slot) < ForkSeq.gloas) {
    return {kind: "ready"};
  }

  const block = blockInput.getBlock() as gloas.SignedBeaconBlock;
  const parentBlockHashHex = toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash);
  if (chain.forkChoice.getBlockHexAndBlockHash(parentRootHex, parentBlockHashHex) !== null) {
    return {kind: "ready"};
  }

  if (chain.forkChoice.hasPayloadHexUnsafe(parentRootHex)) {
    return {kind: "invalidParentPayload", parentRootHex, parentBlockHashHex};
  }

  const parentPayloadInput = chain.seenPayloadEnvelopeInputCache.get(parentRootHex);
  if (parentPayloadInput) {
    if (parentPayloadInput.getBlockHashHex() === parentBlockHashHex) {
      return {kind: "parentPayload", rootHex: parentRootHex};
    }
    return {kind: "invalidParentPayload", parentRootHex, parentBlockHashHex};
  }

  return {kind: "parentPayload", rootHex: parentRootHex};
}
