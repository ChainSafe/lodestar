import {EPOCHS_PER_ETH1_VOTING_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {Node} from "@chainsafe/persistent-merkle-tree";
import {CompositeViewDU} from "@chainsafe/ssz";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "../../types.js";

/**
 * Store vote counts for every eth-execution block that has votes; if any eth-execution block wins majority support within a 1024-slot
 * voting period, formally accept that eth-execution block and set it as the official "latest known eth-execution block" in the eth-consensus state.
 *
 * PERF: Processing cost depends on the current amount of votes.
 * - Best case: Vote is already decided, zero work. See becomesNewEth1Data conditions
 * - Worst case: 1023 votes and no majority vote yet.
 */
export function processEth1Data(state: CachedBeaconStateAllForks, eth1Data: phase0.Eth1Data): void {
  // Convert to view first to hash once and compare hashes
  const eth1DataView = ssz.phase0.Eth1Data.toViewDU(eth1Data);

  if (becomesNewEth1Data(state, eth1DataView)) {
    state.eth1Data = eth1DataView;
  }

  state.eth1DataVotes.push(eth1DataView);
}

/**
 * Returns true if adding the given `eth1Data` to `state.eth1DataVotes` would
 * result in a change to `state.eth1Data`.
 */
export function becomesNewEth1Data(
  state: BeaconStateAllForks,
  newEth1Data: CompositeViewDU<typeof ssz.phase0.Eth1Data>
): boolean {
  const SLOTS_PER_ETH1_VOTING_PERIOD = EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH;

  // If there are not more than 50% votes, then we do not have to count to find a winner.
  if ((state.eth1DataVotes.length + 1) * 2 <= SLOTS_PER_ETH1_VOTING_PERIOD) {
    return false;
  }

  // Nothing to do if the state already has this as eth1data (happens a lot after majority vote is in)
  if (isEqualEth1DataView(state.eth1Data, newEth1Data)) {
    return false;
  }

  // Close to half the EPOCHS_PER_ETH1_VOTING_PERIOD it can be expensive to do so many comparisions.
  // `eth1DataVotes.getAllReadonly()` navigates the tree once to fetch all the LeafNodes efficiently.
  // Then isEqualEth1DataView compares cached roots (HashObject as of Jan 2022) which is much cheaper
  // than doing structural equality, which requires tree -> value conversions
  let sameVotesCount = 0;
  const eth1DataVotes = state.eth1DataVotes.getAllReadonly();
  for (let i = 0; i < eth1DataVotes.length; i++) {
    if (isEqualEth1DataView(eth1DataVotes[i], newEth1Data)) {
      sameVotesCount++;
    }
  }

  // The +1 is to account for the `eth1Data` supplied to the function.
  if ((sameVotesCount + 1) * 2 > SLOTS_PER_ETH1_VOTING_PERIOD) {
    return true;
  } else {
    return false;
  }
}

function isEqualEth1DataView(
  eth1DataA: CompositeViewDU<typeof ssz.phase0.Eth1Data>,
  eth1DataB: CompositeViewDU<typeof ssz.phase0.Eth1Data>
): boolean {
  return isEqualNode(eth1DataA.node, eth1DataB.node);
}

// TODO: Upstream to persistent-merkle-tree
function isEqualNode(nA: Node, nB: Node): boolean {
  const hA = nA.rootHashObject;
  const hB = nB.rootHashObject;
  return (
    hA.h0 === hB.h0 &&
    hA.h1 === hB.h1 &&
    hA.h2 === hB.h2 &&
    hA.h3 === hB.h3 &&
    hA.h4 === hB.h4 &&
    hA.h5 === hB.h5 &&
    hA.h6 === hB.h6 &&
    hA.h7 === hB.h7
  );
}
