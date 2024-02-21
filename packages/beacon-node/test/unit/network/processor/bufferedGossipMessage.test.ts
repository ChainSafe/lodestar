import path from "node:path";
import {Worker} from "node:worker_threads";
import {describe, it, expect} from "vitest";
import {GossipType} from "../../../../src/network/index.js";
import {
  GossipBuffers,
  createGossipBuffersSharedArrayBuffers,
} from "../../../../src/network/processor/bufferedGossipMessage.js";

describe("GossipBuffers", () => {
  it.skip("should round trip a BufferedGossipMessage", () => {
    const sabs = createGossipBuffersSharedArrayBuffers();
    const buffers = new GossipBuffers(sabs);

    const msg = {
      msgTopic: "",
      msgData: Buffer.from("test"),
      msgId: "",
      propagationSource: "",
      seenTimestampSec: 0,
    };
    const written = buffers.writeObject(GossipType.beacon_block, msg);
    expect(written).toBe(true);

    const rcvd = buffers.readObject(GossipType.beacon_block);
    expect(rcvd).toEqual(msg);
  });

  it("should round trip a BufferedGossipMessage across worker", async () => {
    const sabs = createGossipBuffersSharedArrayBuffers();
    const buffers = new GossipBuffers(sabs);

    const topic = GossipType.beacon_block;
    const msg = {
      msgTopic: "",
      msgData: Buffer.from("test"),
      msgId: "",
      propagationSource: "",
      seenTimestampSec: 0,
    };
    const worker = new Worker(path.join(__dirname, "./worker.js"), {
      workerData: {sabs, msg, topic},
    } as ConstructorParameters<typeof Worker>[1]);
    const signal = new AbortController().signal;

    await buffers.awaitNewData(signal);

    const rcvd = buffers.readObject(topic);
    expect(rcvd).toEqual(msg);
  });
});
