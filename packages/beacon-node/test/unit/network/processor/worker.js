import {workerData} from "node:worker_threads";
import {
  // BufferedGossipsubMessage,
  GossipBuffers,
  // GossipBuffersSharedArrayBuffers,
} from "../../../../lib/network/processor/bufferedGossipMessage.js";
// import {GossipType} from "../../../../src/network/index.js";

const {sabs, msg, topic} = workerData;
//  as {
//   sabs: GossipBuffersSharedArrayBuffers;
//   msg: BufferedGossipsubMessage;
//   topic: GossipType;
// };

const buffers = new GossipBuffers(sabs);
buffers.writeObject(topic, msg);
