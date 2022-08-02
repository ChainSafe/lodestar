import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {downloadHeadState} from "./downloadHeadState.js";

/* eslint-disable no-console */

const {state} = await downloadHeadState();

const votesByJson = new Map<string, number>();

// For gnosis 1024 = 64 * 16
const minQuorum = (64 * 16) / 2;
const slotsEllapsed = state.slot % (64 * 16);

for (const [i, eth1DataVote] of state.eth1DataVotes.entries()) {
  const jsonStr = JSON.stringify(ssz.phase0.Eth1DataVotes.elementType.toJson(eth1DataVote));
  votesByJson.set(jsonStr, 1 + (votesByJson.get(jsonStr) ?? 0));

  console.log(`${i} / ${slotsEllapsed}`, toHex(eth1DataVote.blockHash));
}

for (const [jsonStr, voteCount] of votesByJson.entries()) {
  console.log(`${voteCount} / ${minQuorum}`, JSON.parse(jsonStr));
}

console.log("state.eth1Data", ssz.phase0.Eth1Data.toJson(state.eth1Data));
