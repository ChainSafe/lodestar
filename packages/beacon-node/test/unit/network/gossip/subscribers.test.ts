import {generateKeyPair} from "@libp2p/crypto/keys";
import {type GossipSubEvents, TopicValidatorResult} from "@libp2p/gossipsub";
import {type PeerId} from "@libp2p/interface";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {gossipQueues} from "@lodestar/native/gossip-queues";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";
import {Eth2Gossipsub} from "../../../../src/network/gossip/gossipsub.js";
import {GossipType} from "../../../../src/network/gossip/interface.js";
import {stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";
import {type Libp2p} from "../../../../src/network/interface.js";
import {PeersData} from "../../../../src/network/peers/peersData.js";
import * as nativeIngress from "../../../../src/network/processor/nativeIngress.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

const router = vi.hoisted(() => ({
  subscribers: new Map<string, PeerId[]>(),
  streamsOutbound: new Map<string, unknown>(),
  addEventListener:
    vi.fn<(name: "gossipsub:message", listener: (event: GossipSubEvents["gossipsub:message"]) => void) => void>(),
  reportMessageValidationResult: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("@libp2p/gossipsub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@libp2p/gossipsub")>()),
  gossipsub: () => () => ({...router, getSubscribers: (topic: string) => router.subscribers.get(topic) ?? []}),
}));

describe("Eth2Gossipsub", async () => {
  const peers = await Promise.all(
    Array.from({length: 3}, async () => peerIdFromPrivateKey(await generateKeyPair("secp256k1")))
  );
  const nodeId = new Uint8Array(32);
  const config = createBeaconConfig({ALTAIR_FORK_EPOCH: 1}, new Uint8Array(32));
  const networkConfig = {config, nodeId, custodyConfig: new CustodyConfig({config, nodeId})};

  beforeEach(() => {
    router.subscribers.clear();
    router.streamsOutbound.clear();
    vi.clearAllMocks();
  });

  function createGossip(events = new NetworkEventBus(), gossipQueueId?: number): Eth2Gossipsub {
    return new Eth2Gossipsub(
      {skipParamsLog: true},
      {
        clock: {currentSlot: 0, currentSlotWithGossipDisparity: 0},
        networkConfig,
        libp2p: {services: {components: {}}} as unknown as Libp2p,
        logger: getMockedLogger(),
        metricsRegister: null,
        eth2Context: {currentSlot: 0, currentEpoch: 0, activeValidatorCount: 1024},
        peersData: new PeersData(),
        events,
        gossipQueueId,
      }
    );
  }

  it.each([GossipType.beacon_attestation, GossipType.sync_committee])(
    "counts only subscribers with outbound streams for %s without joining the topic",
    (type) => {
      const gossip = createGossip();
      const topic = {type, boundary: config.getForkBoundaryAtEpoch(1), subnet: 1};
      router.subscribers.set(stringifyGossipTopic(config, topic), [peers[0], peers[1]]);
      router.streamsOutbound.set(peers[0].toString(), {});
      router.streamsOutbound.set(peers[2].toString(), {});

      expect(gossip.getSubscribersWithOutboundStream(topic)).toEqual(new Set([peers[0].toString()]));
      expect(router.subscribe).not.toHaveBeenCalled();

      router.streamsOutbound.set(peers[1].toString(), {});
      expect(gossip.getSubscribersWithOutboundStream(topic)).toEqual(
        new Set([peers[0].toString(), peers[1].toString()])
      );
      router.streamsOutbound.delete(peers[0].toString());
      expect(gossip.getSubscribersWithOutboundStream(topic)).toEqual(new Set([peers[1].toString()]));
    }
  );

  it("keeps coverage separate across fork boundaries", () => {
    const gossip = createGossip();
    const previousTopic = {
      type: GossipType.beacon_attestation as const,
      boundary: config.getForkBoundaryAtEpoch(0),
      subnet: 1,
    };
    const currentTopic = {...previousTopic, boundary: config.getForkBoundaryAtEpoch(1)};
    router.subscribers.set(stringifyGossipTopic(config, previousTopic), [peers[0]]);
    router.streamsOutbound.set(peers[0].toString(), {});

    expect(gossip.getSubscribersWithOutboundStream(previousTopic)).toEqual(new Set([peers[0].toString()]));
    expect(gossip.getSubscribersWithOutboundStream(currentTopic).size).toBe(0);
  });

  it("ignores a failed native admission and wakes the consumer for the next message", async () => {
    const events = new NetworkEventBus();
    const wake = vi.fn();
    events.on(NetworkEvent.gossipQueueReady, wake);
    const id = gossipQueues.create(0, 1);
    const offer = vi.spyOn(nativeIngress, "offerGossip").mockImplementationOnce(() => {
      throw Error("OutOfMemory");
    });
    try {
      createGossip(events, id);
      const [[, onMessage]] = router.addEventListener.mock.calls;
      const topic = stringifyGossipTopic(config, {
        type: GossipType.voluntary_exit,
        boundary: config.getForkBoundaryAtEpoch(1),
      });
      const msg = {type: "unsigned" as const, topic, data: new Uint8Array()};
      for (const msgId of ["first", "second"]) {
        onMessage(new CustomEvent("gossipsub:message", {detail: {msgId, propagationSource: peers[0], msg}}));
      }
      expect(wake).toHaveBeenCalledTimes(1);
      await vi.waitFor(() =>
        expect(router.reportMessageValidationResult).toHaveBeenCalledExactlyOnceWith(
          "first",
          peers[0].toString(),
          TopicValidatorResult.Ignore
        )
      );
    } finally {
      offer.mockRestore();
      gossipQueues.close(id);
    }
  });
});
