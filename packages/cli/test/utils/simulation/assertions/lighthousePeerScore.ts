import {ApiError} from "@lodestar/api";
import {CLClient, LighthouseAPI, NodePair, SimulationAssertion} from "../interfaces.js";
import {neverMatcher} from "./matchers.js";

const MIN_GOSSIPSUB_SCORE = 10;

let peersIdMapCache: Record<string, string>;

export const lighthousePeerScoreAssertion: SimulationAssertion<"lighthousePeerScore", {gossipsubScore: number}> = {
  id: "lighthousePeerScore",
  match: neverMatcher,
  async assert({nodes}) {
    const lighthousePeer = nodes.find((n) => n.cl.client === CLClient.Lighthouse);
    if (peersIdMapCache === undefined) {
      peersIdMapCache = await getLodestarPeerIds(nodes);
    }

    const errors = [];

    try {
      const peerScores = await (lighthousePeer?.cl.api as LighthouseAPI).lighthouse.getPeers();
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
          errors.push(
            `Node "${peersIdMapCache[peer_id]}" has low gossipsub score on Lighthouse.  gossipsub_score: ${gossipsub_score}, MIN_GOSSIPSUB_SCORE: ${MIN_GOSSIPSUB_SCORE}`
          );
        }
      }
    } catch (error) {
      errors.push((error as Error).message);
    }

    return errors;
  },
};

async function getLodestarPeerIds(nodes: NodePair[]): Promise<Record<string, string>> {
  const lodestartPeers = nodes.filter((n) => n.cl.client === CLClient.Lodestar);
  const peerIdMap: Record<string, string> = {};

  for (const p of lodestartPeers) {
    const res = await p.cl.api.node.getNetworkIdentity();
    ApiError.assert(res);
    peerIdMap[res.response.data.peerId] = p.cl.id;
  }

  return peerIdMap;
}
