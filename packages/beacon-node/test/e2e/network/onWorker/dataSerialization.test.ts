import {describe, it, beforeAll, afterAll, expect} from "vitest";
import {TopicValidatorResult} from "@libp2p/interface";
import {BitArray} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {getValidPeerId, validPeerIdStr} from "../../../utils/peer.js";
import {ReqRespBridgeEventData} from "../../../../src/network/core/events.js";
import {ReqRespBridgeEvent} from "../../../../src/network/core/events.js";
import {
  GossipType,
  NetworkEvent,
  NetworkEventData,
  PeerAction,
  ReqRespMethod,
  networkEventDirection,
} from "../../../../src/network/index.js";
import {
  BlockInputType,
  BlockSource,
  BlockInput,
  BlockInputDataBlobs,
  CachedData,
} from "../../../../src/chain/blocks/types.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../../../src/constants/constants.js";
import {IteratorEventType} from "../../../../src/util/asyncIterableToEvents.js";
import {NetworkWorkerApi} from "../../../../src/network/core/index.js";
import {EventDirection} from "../../../../src/util/workerEvents.js";
import {CommitteeSubscription} from "../../../../src/network/subnets/interface.js";
import {EchoWorker, getEchoWorker} from "./workerEchoHandler.js";

// TODO: Need to find the way to load the echoWorker in the test environment
describe.skip("data serialization through worker boundary", () => {
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
  const bytes = ZERO_HASH;
  const statusZero = ssz.phase0.Status.defaultValue();

  // Defining tests in this notation ensures that any event data is tested and probably safe to send
  const reqRespBridgeEventData: ReqRespBridgeEventData = {
    [ReqRespBridgeEvent.outgoingRequest]: {id: 0, callArgs: {peerId, method, versions: [1, 2], requestData: bytes}},
    [ReqRespBridgeEvent.outgoingResponse]: {
      type: IteratorEventType.next,
      id: 0,
      item: {data: bytes, fork: ForkName.altair},
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
    [NetworkEvent.peerConnected]: {peer, status: statusZero},
    [NetworkEvent.peerDisconnected]: {peer},
    [NetworkEvent.reqRespRequest]: {
      request: {method: ReqRespMethod.Status, body: statusZero},
      peer: getValidPeerId(),
    },
    [NetworkEvent.unknownBlockParent]: {
      blockInput: {
        type: BlockInputType.preData,
        block: ssz.capella.SignedBeaconBlock.defaultValue(),
        source: BlockSource.gossip,
        blockBytes: ZERO_HASH,
      },
      peer,
    },
    [NetworkEvent.unknownBlock]: {
      rootHex: ZERO_HASH_HEX,
      peer,
    },
    [NetworkEvent.unknownBlockInput]: {
      blockInput: getEmptyBlockInput(),
      peer,
    },
    [NetworkEvent.pendingGossipsubMessage]: {
      topic: {type: GossipType.beacon_block, fork: ForkName.altair},
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
  };

  const lodestarPeer: routes.lodestar.LodestarNodePeer = {
    peerId: peerId,
    enr: "test-enr",
    lastSeenP2pAddress: "/ip4/1.2.3.4/tcp/0",
    state: "connected",
    direction: "inbound",
    agentVersion: "test",
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
      metadata: ssz.altair.Metadata.defaultValue(),
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

function getEmptyBlockInput(): BlockInput {
  let resolveAvailability: ((blobs: BlockInputDataBlobs) => void) | null = null;
  const availabilityPromise = new Promise<BlockInputDataBlobs>((resolveCB) => {
    resolveAvailability = resolveCB;
  });
  if (resolveAvailability === null) {
    throw Error("Promise Constructor was not executed immediately");
  }
  const blobsCache = new Map();

  const cachedData = {fork: ForkName.deneb, blobsCache, availabilityPromise, resolveAvailability} as CachedData;
  return {
    type: BlockInputType.dataPromise,
    block: ssz.deneb.SignedBeaconBlock.defaultValue(),
    source: BlockSource.gossip,
    blockBytes: ZERO_HASH,
    cachedData,
  };
}
