import {ssz} from "@lodestar/types";
import {getClient} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {toHex} from "@lodestar/utils";

/* eslint-disable no-console */

const client = getClient({baseUrl: "http://localhost:4000"}, {config});

const stateBytes = await client.debug.getStateV2("head", "ssz");
const state = ssz.bellatrix.BeaconState.deserialize(stateBytes);

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
