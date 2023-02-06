import fs from "node:fs";
import path from "node:path";
import {Message} from "@libp2p/interface-pubsub";
import {ssz} from "@lodestar/types";
import {createIBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {toHexString} from "@chainsafe/ssz";
import {GossipTopicCache} from "../../../../src/network/gossip/topic.js";
import {msgIdFn} from "../../../../src/network/gossip/encoding.js";

const folder = "/Users/tuyennguyen/Downloads";
const text = fs.readFileSync(path.join(folder, "mainnet_attestations_20230206.json")).toString();
const json = JSON.parse(text) as {data: unknown[]};
console.log("Number of attestations: ", json.data.length);
const attestations = json.data.map((item) => ssz.phase0.Attestation.fromJson(item));
const serializedBytes = attestations.map((att) => ssz.phase0.Attestation.serialize(att));
// hard code to subnet 0 on mainnet
const topic = "/eth2/4a26c58b/beacon_attestation_0/ssz_snappy";
const gossipMessages: Message[] = serializedBytes.map((payload) => ({
  // same to buildRawMessage in gossipsub
  type: "unsigned",
  data: payload,
  topic,
}));

const mainnetGenesisValidatorRoot = ssz.Root.fromJson(
  "0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95"
);
const config = createIBeaconConfig(defaultConfig, mainnetGenesisValidatorRoot);

// to make msgIdFn happy
const gossipTopicCache = new GossipTopicCache(config);
const output = "mainnet_attestations_20230206_message_ids.txt";
for (const message of gossipMessages) {
  const messageId = toHexString(msgIdFn(gossipTopicCache, message));
  // console.log("Message id", messageId);
  fs.appendFileSync(path.join(folder, output), messageId + "\n");
}

console.log(`Wrote to ${output} ${gossipMessages.length} message ids`);
