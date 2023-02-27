import {expect} from "chai";
import {phase0} from "@lodestar/types";
import {MockBeaconChain} from "../../../../utils/mocks/chain/chain.js";
import {assertPeerRelevance, IrrelevantPeerCode} from "../../../../../src/network/peers/utils/assertPeerRelevance.js";
import {BeaconClock} from "../../../../../src/chain/clock/index.js";

describe("network / peers / utils / assertPeerRelevance", () => {
  const correctForkDigest = Buffer.alloc(4, 0);
  const differentForkDigest = Buffer.alloc(4, 1);
  const ZERO_HASH = Buffer.alloc(32, 0);
  const differedRoot = Buffer.alloc(32, 1);

  const testCases: {
    id: string;
    remote: phase0.Status;
    currentSlot?: number;
    irrelevantType: ReturnType<typeof assertPeerRelevance>;
  }[] = [
    {
      id: "Reject incompatible forks",
      remote: {
        forkDigest: differentForkDigest,
        finalizedRoot: ZERO_HASH,
        finalizedEpoch: 0,
        headRoot: ZERO_HASH,
        headSlot: 0,
      },
      irrelevantType: {
        code: IrrelevantPeerCode.INCOMPATIBLE_FORKS,
        ours: correctForkDigest,
        theirs: differentForkDigest,
      },
    },
    {
      id: "Head is too far away from our clock",
      remote: {
        forkDigest: correctForkDigest,
        finalizedRoot: differedRoot,
        finalizedEpoch: 0,
        headRoot: ZERO_HASH,
        headSlot: 100, // Too far from current slot (= 0)
      },
      irrelevantType: {code: IrrelevantPeerCode.DIFFERENT_CLOCKS, slotDiff: 100},
    },
    {
      id: "Accept a finalized epoch equal to ours, with same root",
      remote: {
        forkDigest: correctForkDigest,
        finalizedRoot: ZERO_HASH,
        finalizedEpoch: 0,
        headRoot: ZERO_HASH,
        headSlot: 0,
      },
      irrelevantType: null,
    },
    {
      id: "Accept finalized epoch greater than ours",
      remote: {
        forkDigest: correctForkDigest,
        finalizedRoot: ZERO_HASH,
        finalizedEpoch: 100, // Greater than ours (= 0)
        headRoot: ZERO_HASH,
        headSlot: 0,
      },
      irrelevantType: null,
    },
    {
      id: "Accept during pre-genesis clock",
      remote: {
        forkDigest: correctForkDigest,
        finalizedRoot: ZERO_HASH,
        finalizedEpoch: 0,
        headRoot: ZERO_HASH,
        headSlot: 0,
      },
      // clock slot pre-genesis (< 0) by a good margin
      currentSlot: -50,
      irrelevantType: null,
    },
  ];

  for (const {id, remote, currentSlot, irrelevantType} of testCases) {
    it(id, async () => {
      // Partial instance with only the methods needed for the test
      const chain = ({
        getStatus: () => ({
          forkDigest: correctForkDigest,
          finalizedRoot: ZERO_HASH,
          finalizedEpoch: 0,
          headRoot: ZERO_HASH,
          headSlot: 0,
        }),
        clock: {
          currentSlot: currentSlot ?? 0,
        } as Partial<BeaconClock>,
      } as Partial<MockBeaconChain>) as MockBeaconChain;

      expect(assertPeerRelevance(remote, chain)).to.deep.equal(irrelevantType);
    });
  }
});
