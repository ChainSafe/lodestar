import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-types";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain";
import {
  assertPeerRelevance,
  IrrelevantPeerError,
  IrrelevantPeerErrorCode,
} from "../../../../src/sync/utils/assertPeerRelevance";
import {IBeaconClock} from "../../../../src/chain/clock";
import {expectThrowsLodestarError} from "../../../utils/errors";
import {toHexString} from "@chainsafe/ssz";

describe("sync / utils / assertPeerRelevance", () => {
  const correctForkDigest = Buffer.alloc(4, 0);
  const differentForkDigest = Buffer.alloc(4, 1);
  const ZERO_HASH = Buffer.alloc(32, 0);
  const differedRoot = Buffer.alloc(32, 1);

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
      currentSlot: 0,
    } as Partial<IBeaconClock>,
  } as Partial<MockBeaconChain>) as MockBeaconChain;

  const testCases: {id: string; remote: phase0.Status; error?: IrrelevantPeerError}[] = [
    {
      id: "Reject incompatible forks",
      remote: {
        forkDigest: differentForkDigest,
        finalizedRoot: ZERO_HASH,
        finalizedEpoch: 0,
        headRoot: ZERO_HASH,
        headSlot: 0,
      },
      error: new IrrelevantPeerError({
        code: IrrelevantPeerErrorCode.INCOMPATIBLE_FORKS,
        ours: correctForkDigest,
        theirs: differentForkDigest,
      }),
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
      error: new IrrelevantPeerError({code: IrrelevantPeerErrorCode.DIFFERENT_CLOCKS, slotDiff: 100}),
    },
    {
      id: "Reject non zeroed genesis",
      remote: {
        forkDigest: correctForkDigest,
        finalizedRoot: differedRoot, // non zero root
        finalizedEpoch: 0, // at genesis
        headRoot: ZERO_HASH,
        headSlot: 0,
      },
      error: new IrrelevantPeerError({code: IrrelevantPeerErrorCode.GENESIS_NONZERO, root: toHexString(differedRoot)}),
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
    },
  ];

  for (const {id, remote, error} of testCases) {
    it(id, async () => {
      if (error) {
        expectThrowsLodestarError(() => assertPeerRelevance(remote, chain, config), error);
      } else {
        assertPeerRelevance(remote, chain, config);
      }
    });
  }
});
