export enum GossipEncoding {
  SSZ = "ssz",
  SSZ_SNAPPY = "ssz_snappy"
}

export function getTopicEncoding(topic: string): GossipEncoding {
  if(topic.endsWith(GossipEncoding.SSZ)) {
    return GossipEncoding.SSZ;
  }
  if(topic.endsWith(GossipEncoding.SSZ_SNAPPY)) {
    return GossipEncoding.SSZ_SNAPPY;
  }
  throw `Unknown gossip encoding "${topic.split("/").pop()}"`;
}