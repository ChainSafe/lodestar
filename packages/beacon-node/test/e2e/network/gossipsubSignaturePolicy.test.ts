import {TopicValidatorResult} from "@libp2p/gossipsub";
import {RPC} from "@libp2p/gossipsub/message";
import {Stream} from "@libp2p/interface";
import {LengthPrefixedStream, lpStream} from "@libp2p/utils";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, GENESIS_EPOCH, ZERO_HASH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {NetworkEvent, NetworkEventBus, NetworkEventData} from "../../../src/network/events.js";
import {DataTransformSnappy} from "../../../src/network/gossip/encoding.js";
import {Eth2Gossipsub} from "../../../src/network/gossip/gossipsub.js";
import {GossipType} from "../../../src/network/gossip/interface.js";
import {GossipTopicCache, stringifyGossipTopic} from "../../../src/network/gossip/topic.js";
import {Libp2p} from "../../../src/network/interface.js";
import {PeersData} from "../../../src/network/peers/peersData.js";
import {CustodyConfig} from "../../../src/util/dataColumns.js";
import {createNode} from "../../utils/network.js";

describe("gossipsub / StrictNoSign", () => {
  const protocol = "/meshsub/1.1.0";
  const config = createBeaconConfig({ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0, CAPELLA_FORK_EPOCH: 0}, ZERO_HASH);
  const topic = {
    type: GossipType.bls_to_execution_change,
    boundary: {fork: ForkName.capella, epoch: GENESIS_EPOCH},
  } as const;
  const topicStr = stringifyGossipTopic(config, topic);
  const transform = new DataTransformSnappy(new GossipTopicCache(config), null);
  const cleanMessage: RPC.Message = {
    topic: topicStr,
    data: transform.outboundTransform(
      topicStr,
      ssz.capella.SignedBLSToExecutionChange.serialize(ssz.capella.SignedBLSToExecutionChange.defaultValue())
    ),
  };
  const marker = ssz.capella.SignedBLSToExecutionChange.defaultValue();
  marker.message.validatorIndex = 1;
  const markerMessage: RPC.Message = {
    topic: topicStr,
    data: transform.outboundTransform(topicStr, ssz.capella.SignedBLSToExecutionChange.serialize(marker)),
  };

  const nodes: Libp2p[] = [];
  let gossip: Eth2Gossipsub;
  let sender: Libp2p;
  let senderStream: LengthPrefixedStream<Stream>;
  let receiverStream: LengthPrefixedStream<Stream>;
  let events: NetworkEventBus;
  const onMessage = vi.fn(({msgId, propagationSource}: NetworkEventData[NetworkEvent.pendingGossipsubMessage]) => {
    events.emit(NetworkEvent.gossipMessageValidationResult, {
      msgId,
      propagationSource,
      acceptance: TopicValidatorResult.Accept,
    });
  });

  beforeEach(async () => {
    const relay = await createNode(["/ip4/127.0.0.1/tcp/0"]);
    nodes.push(relay);
    events = new NetworkEventBus();
    events.on(NetworkEvent.pendingGossipsubMessage, onMessage);
    gossip = new Eth2Gossipsub(
      {gossipsubAwaitHandler: true, skipParamsLog: true},
      {
        networkConfig: {config, nodeId: ZERO_HASH, custodyConfig: new CustodyConfig({config, nodeId: ZERO_HASH})},
        libp2p: relay,
        logger: testLogger(),
        metricsRegister: null,
        eth2Context: {activeValidatorCount: 16384, currentSlot: 0, currentEpoch: 0},
        peersData: new PeersData(),
        events,
      }
    );
    await gossip.start();
    gossip.subscribeTopic(topic);

    const source = await connectRawPeer(relay);
    sender = source.node;
    senderStream = source.outbound;
    const receiver = await connectRawPeer(relay);
    receiverStream = receiver.inbound;
    await receiver.outbound.write(
      RPC.encode({
        subscriptions: [{topic: topicStr, subscribe: true}],
        control: {graft: [{topicID: topicStr}], prune: [], ihave: [], iwant: [], idontwant: []},
      })
    );
    await vi.waitFor(() => expect(gossip.getMeshPeers(topicStr)).toContain(receiver.node.peerId.toString()));
  });

  afterEach(async () => {
    await gossip?.stop();
    await Promise.all(nodes.splice(0).map((node) => node.stop()));
    events?.off(NetworkEvent.pendingGossipsubMessage, onMessage);
  });

  it("accepts and forwards unsigned messages", async () => {
    await senderStream.write(RPC.encode({messages: [cleanMessage, markerMessage]}));

    expect(await readForwardedMessages()).toEqual([cleanMessage, markerMessage]);
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(gossip.dumpPeerScoreStats()[sender.peerId.toString()].topics[topicStr].invalidMessageDeliveries).toBe(0);
  });

  for (const field of ["from", "seqno", "signature", "key"] as const) {
    it.each([0, 32])(`rejects ${field} with %i bytes`, async (length) => {
      const malformedMessage = {...cleanMessage, [field]: new Uint8Array(length).fill(0xa0)};
      // Repeat before the clean message to check rejection before caching its message ID.
      await senderStream.write(
        RPC.encode({messages: [malformedMessage, malformedMessage, cleanMessage, markerMessage]})
      );

      expect(await readForwardedMessages(), `${field} with ${length} bytes`).toEqual([cleanMessage, markerMessage]);
      expect(onMessage, `${field} with ${length} bytes`).toHaveBeenCalledTimes(2);
      expect(
        gossip.dumpPeerScoreStats()[sender.peerId.toString()].topics[topicStr].invalidMessageDeliveries,
        `${field} with ${length} bytes`
      ).toBe(2);
    });
  }

  async function connectRawPeer(relay: Libp2p) {
    const node = await createNode(["/ip4/127.0.0.1/tcp/0"]);
    nodes.push(node);
    let onIncomingStream: (stream: Stream) => void;
    const incoming = new Promise<Stream>((resolve) => {
      onIncomingStream = resolve;
    });
    await node.handle(protocol, (stream) => onIncomingStream(stream));
    const outbound = lpStream(await node.dialProtocol(relay.getMultiaddrs(), protocol));
    const inbound = lpStream(await incoming);
    expect(RPC.decode(await inbound.read()).subscriptions).toContainEqual({topic: topicStr, subscribe: true});
    return {node, outbound, inbound};
  }

  async function readForwardedMessages(): Promise<RPC.Message[]> {
    const messages: RPC.Message[] = [];
    const signal = AbortSignal.timeout(3000);
    while (!messages.some((message) => Buffer.from(message.data ?? []).equals(Buffer.from(markerMessage.data ?? [])))) {
      messages.push(...RPC.decode(await receiverStream.read({signal})).messages);
    }
    return messages;
  }
});
