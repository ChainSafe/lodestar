// import {config} from "../../../utils/config.js";
// import {GossipTopicCache, stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";
// import {GossipEncoding, GossipTopic, GossipType} from "../../../../src/network/index.js";
// import {ForkName} from "@lodestar/params";
// import {Message} from "@libp2p/interface-pubsub";
// import {msgIdFn} from "../../../../src/network/gossip/encoding.js";
// import {toHexString} from "@chainsafe/ssz";
// import {expect} from "chai";

// const encoding = GossipEncoding.ssz_snappy;
// const gossipType = GossipType.beacon_block;

// const msgData = Buffer.alloc(201, 1);

// const testCases: {name: string; fork: ForkName; topicStr: string; msgId: string}[] = [
//   {name: "beacon topic phase0", fork: ForkName.phase0, topicStr: "/eth2/18ae4ccb/beacon_block/ssz_snappy", msgId: "0x6844b16efbba6ed8972098694807a2e973f7a541"},
//   {name: "beacon topic altair", fork: ForkName.altair, topicStr: "/eth2/8e04f66f/beacon_block/ssz_snappy", msgId: "0xc3cdd02efd4269e35b339511e9a8cfec75124fba"},
// ];
// describe("msgIdFn", () => {

//   for (const {name, fork, topicStr, msgId: expected} of testCases) {
//     it(name, () => {
//       const cache = new GossipTopicCache(config);
//       const topic: GossipTopic = {
//         type: gossipType,
//         fork,
//         encoding
//       };
//       cache.setTopic(topicStr, topic);
//       const msg: Message = {
//         type: "unsigned",
//         topic: topicStr,
//         data: msgData
//       };
//       const msgId = msgIdFn(cache, msg);
//       expect(toHexString(msgId)).to.be.equal(expected, "incorrect message id");
//     });
//   }
// });
