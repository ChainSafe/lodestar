import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Slot, Status} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {GoodByeReasonCode} from "../../../src/constants/index.js";
import {PeerAction} from "../../../src/network/index.js";
import {BeaconSync} from "../../../src/sync/sync.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {MockedBeaconDb, getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";
import {MockedNetwork, getMockedNetwork} from "../../mocks/mockedNetwork.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("BeaconSync.verifyPastFinalizedCheckpoint", () => {
  const peer = "peer";
  const finalizedEpoch = 4;
  const startSlot = computeStartSlotAtEpoch(finalizedEpoch);
  const finalizedRoot = Buffer.alloc(32, 1);
  const otherRoot = Buffer.alloc(32, 2);
  const remote: Status = {
    forkDigest: Buffer.alloc(4),
    finalizedRoot,
    finalizedEpoch,
    headRoot: Buffer.alloc(32, 3),
    headSlot: startSlot + 1,
  };

  let chain: MockedBeaconChain;
  let db: MockedBeaconDb;
  let network: MockedNetwork;
  let sync: BeaconSync;

  beforeEach(() => {
    chain = getMockedBeaconChain();
    db = getMockedBeaconDb();
    network = getMockedNetwork();
    network.reportPeer = vi.fn();
    network.goodbyeAndDisconnect = vi.fn();
    chain.forkChoice.getHead.mockReturnValue(generateProtoBlock());
    sync = new BeaconSync(
      {disableRangeSync: true, disableBlockInputSync: true, isSingleNode: true},
      {config: chain.config, chain, db, network, metrics: null, logger: testLogger()}
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const testCases: {
    id: string;
    canonicalRoot: Buffer | null;
    slot?: Slot | null;
    childSlot?: Slot | null;
    earliestAvailableSlot?: Slot;
    rejected: boolean;
  }[] = [
    {id: "fork choice canonical block matches", canonicalRoot: finalizedRoot, rejected: false},
    {id: "fork choice canonical block differs", canonicalRoot: otherRoot, rejected: true},
    {id: "db root at epoch start", canonicalRoot: null, slot: startSlot, rejected: false},
    {id: "db root after epoch start", canonicalRoot: null, slot: startSlot + 1, rejected: true},
    {
      id: "db root before epoch start, child after epoch start",
      canonicalRoot: null,
      slot: startSlot - 2,
      childSlot: startSlot + 1,
      rejected: false,
    },
    {
      id: "db root before epoch start, child at epoch start",
      canonicalRoot: null,
      slot: startSlot - 2,
      childSlot: startSlot,
      rejected: true,
    },
    {
      id: "db root pruned, child after epoch start",
      canonicalRoot: null,
      slot: null,
      childSlot: startSlot + 1,
      rejected: false,
    },
    {
      id: "db root and child unknown after earliest available slot",
      canonicalRoot: null,
      slot: null,
      childSlot: null,
      earliestAvailableSlot: startSlot - 1,
      rejected: true,
    },
    {
      id: "db root and child unknown at earliest available slot",
      canonicalRoot: null,
      slot: null,
      childSlot: null,
      earliestAvailableSlot: startSlot,
      rejected: false,
    },
  ];

  it.each(testCases)("$id", async ({canonicalRoot, slot, childSlot, earliestAvailableSlot, rejected}) => {
    chain.forkChoice.getCanonicalBlockClosestLteSlot.mockReturnValue(
      canonicalRoot && generateProtoBlock({slot: startSlot, blockRoot: toRootHex(canonicalRoot)})
    );
    db.blockArchive.getSlotByRoot.mockResolvedValue(slot ?? null);
    db.blockArchive.getSlotByParentRoot.mockResolvedValue(childSlot ?? null);
    chain.earliestAvailableSlot = earliestAvailableSlot ?? 0;

    await sync.verifyPastFinalizedCheckpoint(peer, remote);

    if (rejected) {
      expect(network.reportPeer).toHaveBeenCalledWith(peer, PeerAction.Fatal, "PeerFinalizedCheckpointMismatch");
      expect(network.goodbyeAndDisconnect).toHaveBeenCalledWith(peer, GoodByeReasonCode.IRRELEVANT_NETWORK);
    } else {
      expect(network.reportPeer).not.toHaveBeenCalled();
      expect(network.goodbyeAndDisconnect).not.toHaveBeenCalled();
    }
  });
});
