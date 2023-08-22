import {ApiError} from "@lodestar/api";
import {AssertionResult, BeaconClient, LighthouseAPI, NodePair, SimulationAssertion} from "../interfaces.js";
import {neverMatcher} from "./matchers.js";

const MIN_GOSSIPSUB_SCORE = 10;

let peersIdMapCache: Record<string, string>;

export const lighthousePeerScoreAssertion: SimulationAssertion<"lighthousePeerScore", {gossipsubScore: number}> = {
  id: "lighthousePeerScore",
  match: neverMatcher,
  async assert({nodes, node}) {
    // We want to run this only once, not every node
    if (node.id !== nodes[0].id) return [];

    const lighthousePeer = nodes.find((n) => n.beacon.client === BeaconClient.Lighthouse);
    if (peersIdMapCache === undefined) {
      peersIdMapCache = await getLodestarPeerIds(nodes);
    }

    const errors: AssertionResult[] = [];

    try {
      const peerScores = await (lighthousePeer?.beacon.api as LighthouseAPI).lighthouse.getPeers();
      for (const peerScore of peerScores.body) {
        const {
          peer_id,
          peer_info: {
            score: {
              Real: {gossipsub_score},
            },
          },
        } = peerScore;
        if (gossipsub_score < MIN_GOSSIPSUB_SCORE) {
          errors.push([
            `Node "${peersIdMapCache[peer_id]}" has low gossipsub score on Lighthouse`,
            {gossipsubScore: gossipsub_score, minGossipsubScore: MIN_GOSSIPSUB_SCORE},
          ]);
        }
      }
    } catch (error) {
      errors.push((error as Error).message);
    }

    return errors;
  },
};

async function getLodestarPeerIds(nodes: NodePair[]): Promise<Record<string, string>> {
  const lodestartPeers = nodes.filter((n) => n.beacon.client === BeaconClient.Lodestar);
  const peerIdMap: Record<string, string> = {};

  for (const p of lodestartPeers) {
    const res = await p.beacon.api.node.getNetworkIdentity();
    ApiError.assert(res);
    peerIdMap[res.response.data.peerId] = p.beacon.id;
  }

  return peerIdMap;
}
