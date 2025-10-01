import {TopicValidatorResult} from "@libp2p/interface";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../../../src/constants/constants.js";
import {ReqRespBridgeEvent, ReqRespBridgeEventData} from "../../../../src/network/core/events.js";
import {NetworkWorkerApi} from "../../../../src/network/core/index.js";
import {
  GossipType,
  NetworkEvent,
  NetworkEventData,
  PeerAction,
  ReqRespMethod,
  networkEventDirection,
} from "../../../../src/network/index.js";
import {CommitteeSubscription} from "../../../../src/network/subnets/interface.js";
import {IteratorEventType} from "../../../../src/util/asyncIterableToEvents.js";
import {EventDirection} from "../../../../src/util/workerEvents.js";
import {getValidPeerId, validPeerIdStr} from "../../../utils/peer.js";
import {EchoWorker, getEchoWorker} from "./workerEchoHandler.js";

describe("data serialization through worker boundary", () => {
  let echoWorker: EchoWorker;

  beforeAll(async () => {
    echoWorker = await getEchoWorker();
  });

  afterAll(async () => {
    // Guard against before() erroring
    if (echoWorker != null) await echoWorker.close();
  });

  const peerId = validPeerIdStr;
  const peer = validPeerIdStr;
  const method = ReqRespMethod.BeaconBlocksByRange;
  const bytes = Uint8Array.from(ZERO_HASH);
  const statusZero = ssz.phase0.Status.defaultValue();

  // Defining tests in this notation ensures that any event data is tested and probably safe to send
  const reqRespBridgeEventData: ReqRespBridgeEventData = {
    [ReqRespBridgeEvent.outgoingRequest]: {id: 0, callArgs: {peerId, method, versions: [1, 2], requestData: bytes}},
    [ReqRespBridgeEvent.outgoingResponse]: {
      type: IteratorEventType.next,
      id: 0,
      item: {data: bytes, boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH}},
    },
    [ReqRespBridgeEvent.incomingRequest]: {id: 0, callArgs: {method, req: {data: bytes, version: 1}, peerId}},
    [ReqRespBridgeEvent.incomingResponse]: {
      type: IteratorEventType.next,
      id: 0,
      item: {data: bytes, fork: ForkName.altair, protocolVersion: 1},
    },
  };

  // Filter out events that are not meant to cross the worker boundary
  function filterByUsedEvents<T extends object>(
    eventsByDirection: Record<keyof T, EventDirection>,
    eventData: T
  ): Partial<T> {
    for (const key of Object.keys(eventData) as (keyof T)[]) {
      if (eventsByDirection[key] === EventDirection.none) {
        delete eventData[key];
      }
    }
    return eventData;
  }

  // Defining tests in this notation ensures that any event data is tested and probably safe to send
  const networkEventData = filterByUsedEvents<NetworkEventData>(networkEventDirection, {
    [NetworkEvent.peerConnected]: {peer, status: statusZero, custodyColumns: [1, 2, 3, 4], clientAgent: "CLIENT_AGENT"},
    [NetworkEvent.peerDisconnected]: {peer},
    [NetworkEvent.reqRespRequest]: {
      request: {method: ReqRespMethod.Status, body: statusZero},
      peer: getValidPeerId(),
    },
    [NetworkEvent.pendingGossipsubMessage]: {
      topic: {type: GossipType.beacon_block, boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH}},
      msg: {
        type: "unsigned",
        topic: "test-topic",
        data: bytes,
      },
      msgSlot: 1000,
      msgId: ZERO_HASH_HEX,
      propagationSource: peerId,
      seenTimestampSec: 1600000000,
      startProcessUnixSec: 1600000000,
    },
    [NetworkEvent.gossipMessageValidationResult]: {
      msgId: ZERO_HASH_HEX,
      propagationSource: peerId,
      acceptance: TopicValidatorResult.Accept,
    },
  });

  const committeeSubscription: CommitteeSubscription = {
    validatorIndex: 0,
    subnet: 0,
    slot: 0,
    isAggregator: false,
  };

  const workerApiParameters: {[K in keyof NetworkWorkerApi]: Parameters<NetworkWorkerApi[K]>} = {
    prepareBeaconCommitteeSubnets: [[committeeSubscription]],
    prepareSyncCommitteeSubnets: [[committeeSubscription]],
    getNetworkIdentity: [],
    subscribeGossipCoreTopics: [],
    unsubscribeGossipCoreTopics: [],
    connectToPeer: [peerId, ["/ip4/1.2.3.4/tcp/13000"]],
    disconnectPeer: [peerId],
    dumpPeers: [],
    dumpPeer: [peerId],
    dumpPeerScoreStats: [],
    dumpGossipPeerScoreStats: [],
    dumpDiscv5KadValues: [],
    dumpMeshPeers: [],
    reportPeer: [peerId, PeerAction.Fatal, "test-invalid"],
    reStatusPeers: [[peerId]],
    getConnectedPeers: [],
    getConnectedPeerCount: [],
    updateStatus: [statusZero],
    publishGossip: ["test-topic", bytes, {allowPublishToZeroTopicPeers: true, ignoreDuplicatePublishError: true}],
    close: [],
    scrapeMetrics: [],
    writeProfile: [0, ""],
    writeDiscv5Profile: [0, ""],
    setTargetGroupCount: [4],
    setAdvertisedGroupCount: [4],
  };

  const lodestarPeer: routes.lodestar.LodestarNodePeer = {
    peerId: peerId,
    enr: "test-enr",
    lastSeenP2pAddress: "/ip4/1.2.3.4/tcp/0",
    state: "connected",
    direction: "inbound",
    agentVersion: "test",
    status: null,
    metadata: null,
    agentClient: "test",
    lastReceivedMsgUnixTsMs: 0,
    lastStatusUnixTsMs: 0,
    connectedUnixTsMs: 0,
  };

  // If return type is void, set to null
  const workerApiReturnType: {[K in keyof NetworkWorkerApi]: Resolves<ReturnType<NetworkWorkerApi[K]>>} = {
    prepareBeaconCommitteeSubnets: null,
    prepareSyncCommitteeSubnets: null,
    getNetworkIdentity: {
      peerId,
      enr: "test-enr",
      p2pAddresses: ["/ip4/1.2.3.4/tcp/0"],
      discoveryAddresses: ["/ip4/1.2.3.4/tcp/0"],
      metadata: ssz.fulu.Metadata.defaultValue(),
    },
    subscribeGossipCoreTopics: null,
    unsubscribeGossipCoreTopics: null,
    connectToPeer: null,
    disconnectPeer: null,
    dumpPeers: [lodestarPeer],
    dumpPeer: lodestarPeer,
    dumpPeerScoreStats: [],
    dumpGossipPeerScoreStats: {
      [peerId]: {
        connected: true,
        expire: 1,
        topics: {
          "test-topic": {
            inMesh: true,
            graftTime: 1,
            meshTime: 1,
            firstMessageDeliveries: 1,
            meshMessageDeliveries: 1,
            meshMessageDeliveriesActive: true,
            meshFailurePenalty: 1,
            invalidMessageDeliveries: 1,
          },
        },
        knownIPs: new Set(["1.2.3.4"]),
        behaviourPenalty: 1,
      },
    },
    dumpDiscv5KadValues: [],
    dumpMeshPeers: {
      "test-topic": [peerId],
    },
    reportPeer: null,
    reStatusPeers: null,
    getConnectedPeers: [peerId],
    getConnectedPeerCount: 100,
    updateStatus: null,
    publishGossip: 1,
    close: null,
    scrapeMetrics: "test-metrics",
    writeProfile: "",
    writeDiscv5Profile: "",
    setAdvertisedGroupCount: null,
    setTargetGroupCount: null,
  };

  type TestCase = {id: string; data: unknown; shouldFail?: boolean};

  function fromObjData(prefix: string, data: Record<string, unknown>): TestCase[] {
    return Object.entries(data).map(([ev, data]) => ({id: `${prefix} - ${ev}`, data}));
  }

  const testCases: TestCase[] = [
    {id: "number", data: 1000},
    {id: "string", data: "some-string"},
    {id: "bigint", data: BigInt(1000)},
    {id: "PeerId", data: getValidPeerId(), shouldFail: true},
    {id: "Status", data: ssz.phase0.Status.defaultValue()},
    {id: "BitArray", data: BitArray.fromSingleBit(130, 1)},
    ...fromObjData("ReqRespBridgeEvent", reqRespBridgeEventData),
    ...fromObjData("NetworkEvent", networkEventData),
    ...fromObjData("NetworkWorkerApi Parameters", workerApiParameters),
    ...fromObjData("NetworkWorkerApi ReturnType", workerApiReturnType),
  ];

  for (const testCase of testCases) {
    it(testCase.id, async () => {
      const dataPong = await echoWorker.send(testCase.data);
      if (testCase.shouldFail) {
        expect(dataPong).not.toEqual(testCase.data);
      } else {
        expect(dataPong).toEqual(testCase.data);
      }
    });
  }
});

type Resolves<T extends Promise<unknown>> = T extends Promise<infer U> ? (U extends void ? null : U) : never;
