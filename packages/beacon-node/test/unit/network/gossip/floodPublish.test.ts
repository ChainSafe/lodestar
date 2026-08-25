import {describe, expect, it} from "vitest";
import {selectAllTopicPeersToPublish} from "../../../../src/network/gossip/gossipsub.js";
import {GossipType} from "../../../../src/network/gossip/index.js";
import {gossipTopicFloodPublish} from "../../../../src/network/gossip/topic.js";

describe("gossip flood publish", () => {
  it("flood publishes builder bids only", () => {
    const floodTopics = Object.entries(gossipTopicFloodPublish)
      .filter(([, flood]) => flood)
      .map(([type]) => type);
    expect(floodTopics).toEqual([GossipType.execution_payload_bid]);
  });

  it("selects direct peers and every topic peer above the publish threshold", () => {
    const topic = "/eth2/00000000/execution_payload_bid/ssz_snappy";
    const scores: Record<string, number> = {direct: -100, good: 0, bad: -10, other: 0};
    const gossipsub = {
      topics: new Map([[topic, new Set(["direct", "good", "bad"])]]),
      direct: new Set(["direct"]),
      score: {score: (id: string) => scores[id]},
      opts: {scoreThresholds: {publishThreshold: -5}},
    };

    const {tosend, tosendCount} = selectAllTopicPeersToPublish(gossipsub, topic);

    // Direct peers are always included, "other" is not subscribed, "bad" is below the threshold
    expect([...tosend].sort()).toEqual(["direct", "good"]);
    expect(tosendCount).toEqual({direct: 1, floodsub: 1, mesh: 0, fanout: 0});
  });

  it("selects nobody for a topic without peers", () => {
    const gossipsub = {
      topics: new Map<string, Set<string>>(),
      direct: new Set<string>(),
      score: {score: () => 0},
      opts: {scoreThresholds: {publishThreshold: 0}},
    };
    expect(selectAllTopicPeersToPublish(gossipsub, "/eth2/00000000/execution_payload_bid/ssz_snappy").tosend.size).toBe(
      0
    );
  });
});
