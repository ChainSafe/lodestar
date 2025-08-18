import {RootHex, Slot} from "@lodestar/types";
import {PeerIdStr} from "../../util/peerId.js";

/** A sync item a simplified block header for purposes of this syncing mechanism */
export type Header = {
  slot: Slot;
  root: RootHex;
  parentRoot: RootHex;
};

export enum ChainState {
  /** Only a lone block root is known */
  UnknownHead = "unknown head",
  /** A chain of headers is known, but the earliest ancestor is not known */
  UnknownAncestor = "unknown ancestor",
  /** A chain of headers is known and has been verified to be linked to our known chain */
  Linked = "linked",
}

export enum DownloadState {
  Idle = "idle",
  Fetching = "fetching",
  Failed = "failed",
}

export type UnknownHeadBackwardsChain = {
  state: ChainState.UnknownHead;
  downloadState: DownloadState;
  headRoot: RootHex;
  ancestors: Map<RootHex, Header>;
  peers: Set<PeerIdStr>;
  lastUpdate: number;
};
export type UnknownAncestorBackwardsChain = {
  state: ChainState.UnknownAncestor;
  downloadState: DownloadState;
  headRoot: RootHex;
  head: Header;
  earliestKnownAncestor: RootHex;
  ancestors: Map<RootHex, Header>;
  peers: Set<PeerIdStr>;
  lastUpdate: number;
};
export type LinkedBackwardsChain = {
  state: ChainState.Linked;
  downloadState: DownloadState;
  headRoot: RootHex;
  head: Header;
  forwardChain: Header[];
  ancestors: Map<RootHex, Header>;
  peers: Set<PeerIdStr>;
  lastUpdate: number;
};

/**
 * A backwards chain is a chain of unknown block headers.
 * Backwards because we usually track chains in the forwards direction.
 * Unknown because they are not part of our known chain.
 *
 * There are three types of backwards chains:
 * - Unknown Head: Only a lone block root is known, no ancestors are known.
 * - Unknown Ancestor: A chain of headers is known, but the earliest ancestor is not known.
 * - Linked: A chain of headers is known and has been verified to be linked to our known chain. It is maintained until it has been processed.
 *
 * The chain can be operated on in the following ways:
 * - Advance the chain: Add an ancestor to the chain. Advance backwards by one ancestor.
 * - Merge the chain: Merge another chain into the chain. Advance backwards by all ancestors of the other chain.
 * - Link the chain: Set the chain state to Linked
 */
export type BackwardsChain = UnknownHeadBackwardsChain | UnknownAncestorBackwardsChain | LinkedBackwardsChain;

export enum ChainAdvanceResult {
  /** The chain was advanced */
  Advanced,
  /** The chain was not advanced */
  NotAdvanced,
}

/**
 * Advance the chain if the sync item is the head.
 *
 * Return true if the chain was advanced, false if it was not.
 *
 * UnknownHead -> UnknownAncestor
 */
export function addHeadHeader(chain: UnknownHeadBackwardsChain, header: Header): ChainAdvanceResult {
  if (chain.headRoot !== header.root) {
    return ChainAdvanceResult.NotAdvanced;
  }

  const _chain = chain as unknown as UnknownAncestorBackwardsChain;
  _chain.state = ChainState.UnknownAncestor;
  _chain.earliestKnownAncestor = header.parentRoot;
  _chain.head = header;
  _chain.lastUpdate = Date.now();

  return ChainAdvanceResult.Advanced;
}

/**
 * Advance the chain if the sync item is the earliest known ancestor.
 *
 * UnknownAncestor -> UnknownAncestor
 */
export function addAncestorHeader(chain: UnknownAncestorBackwardsChain, header: Header): ChainAdvanceResult {
  if (chain.earliestKnownAncestor !== header.root) {
    return ChainAdvanceResult.NotAdvanced;
  }

  chain.ancestors.set(header.root, header);
  chain.earliestKnownAncestor = header.parentRoot;
  chain.lastUpdate = Date.now();

  return ChainAdvanceResult.Advanced;
}

/**
 * Advance the chain if the sync item is a child of the head.
 *
 * If ChainAdvanceResult.Advanced is returned, the chain is now in UnknownAncestor state.
 */
export function advanceChain(chain: BackwardsChain, header: Header): ChainAdvanceResult {
  if (chain.state === ChainState.Linked) {
    // Chain is already linked, no need to advance
    return ChainAdvanceResult.NotAdvanced;
  }

  if (chain.state === ChainState.UnknownAncestor) {
    return addAncestorHeader(chain, header);
  }
  return addHeadHeader(chain, header);
}

/**
 * Combine otherChain into chain
 */
export function mergeChain(chain: UnknownAncestorBackwardsChain, otherChain: BackwardsChain): void {
  // sanity check
  if (chain.earliestKnownAncestor !== otherChain.headRoot) {
    throw new Error("Cannot merge chains, earliestKnownAncestor does not match headRoot");
  }

  // Merge the other chain's peers into this chain
  for (const peer of otherChain.peers) {
    chain.peers.add(peer);
  }
  // Merge the other chain's ancestors into this chain
  for (const [root, header] of otherChain.ancestors.entries()) {
    chain.ancestors.set(root, header);
  }
  // Update the state of the chain based on the other chain's state
  if (otherChain.state === ChainState.UnknownAncestor) {
    // In the case of UnknownAncestor, we can simply update the earliest known ancestor
    chain.earliestKnownAncestor = otherChain.earliestKnownAncestor;
  } else if (otherChain.state === ChainState.Linked) {
    // In the case of Linked, we upgrade the state to Linked and need to merge the forward chain from the other chain
    const _chain = linkChain(chain);
    _chain.forwardChain = otherChain.forwardChain.concat(_chain.forwardChain);
  }
  chain.lastUpdate = Date.now();
}

/**
 * Set a chain's state to Linked.
 *
 * This involves creating a forward chain.
 *
 * UnknownAncestor -> Linked
 */
export function linkChain(chain: UnknownAncestorBackwardsChain): LinkedBackwardsChain {
  const _chain = chain as unknown as LinkedBackwardsChain;
  _chain.state = ChainState.Linked;
  _chain.lastUpdate = Date.now();
  // In the case of Linked, we upgrade the state to Linked and need to merge the forward chain from the other chain
  const forwardChain = [chain.head];
  let current = chain.head as Header | undefined;
  while (current) {
    current = chain.ancestors.get(current.parentRoot) as Header;
    if (!current) {
      break;
    }
    forwardChain.push(current);
  }

  _chain.forwardChain = forwardChain;
  return _chain;
}
