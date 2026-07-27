import {afterEach, describe, expect, it, vi} from "vitest";
import {BeaconConfig, createBeaconConfig} from "@lodestar/config";
import {chainConfig as defaultChainConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {phase0} from "@lodestar/types";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {INetwork} from "../../../../src/network/index.js";
import {RangeSync} from "../../../../src/sync/range/range.js";
import {MockedBeaconChain, ProtoBlock, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {validPeerIdStr} from "../../../utils/peer.js";

describe("sync / range / RangeSync", () => {
  const logger = testLogger();

  // A far-behind node with a finalized checkpoint we do not yet have, so addPeer() takes the
  // "Finalized" branch of getRangeSyncTarget and creates a new SyncChain.
  const localStatus: phase0.Status = {
    forkDigest: Buffer.alloc(4, 0),
    finalizedRoot: Buffer.alloc(32, 1),
    finalizedEpoch: 0,
    headRoot: Buffer.alloc(32, 2),
    headSlot: 0,
  };
  const remoteStatus: phase0.Status = {
    forkDigest: Buffer.alloc(4, 0),
    finalizedRoot: Buffer.alloc(32, 3),
    finalizedEpoch: 100,
    headRoot: Buffer.alloc(32, 4),
    headSlot: 3200,
  };

  function getNetworkMock(): INetwork {
    // getConnectedPeerSyncMeta -> null keeps the constructor-started sync loop idle (no peer to download from)
    return {
      getConnectedPeerSyncMeta: vi.fn().mockReturnValue(null),
      reportPeer: vi.fn(),
      reStatusPeers: vi.fn().mockResolvedValue(undefined),
    } as Partial<INetwork> as INetwork;
  }

  function getRangeSync(chain: MockedBeaconChain, config: BeaconConfig): RangeSync {
    chain.forkChoice.hasBlock.mockReturnValue(false);
    chain.forkChoice.getHead.mockReturnValue({slot: 64, blockRoot: "0x00"} as ProtoBlock);
    // SyncChain starts its sync loop in the constructor; when it ends, onSyncChainEnd reads the
    // finalized checkpoint. Provide it so the async teardown does not throw in this unit test.
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 0, root: new Uint8Array(32), rootHex: "0x00"});
    return new RangeSync({
      chain: chain as unknown as IBeaconChain,
      network: getNetworkMock(),
      metrics: null,
      config,
      logger,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a finalized sync chain pre-gloas without reading the head state", () => {
    // default config has GLOAS_FORK_EPOCH=Infinity, so the head-state read for gloas empty-block
    // detection is unnecessary and must be skipped entirely (this is the site that wedged sync).
    const preGloasConfig = createBeaconConfig(defaultChainConfig, Buffer.alloc(32, 0));
    const chain = getMockedBeaconChain();
    const rangeSync = getRangeSync(chain, preGloasConfig);

    expect(() => rangeSync.addPeer(validPeerIdStr, localStatus, remoteStatus)).not.toThrow();

    expect(chain.getHeadState).not.toHaveBeenCalled();
    expect(rangeSync.getSyncChainsDebugState()).toHaveLength(1);
  });

  it("still creates the sync chain post-gloas when getHeadState throws (evicted head state)", () => {
    // Regression for https://github.com/ChainSafe/lodestar/issues/9716 : when far behind, the head
    // can advance past the retained post-state, so getHeadState() throws. That used to escape as an
    // uncaughtException before the SyncChain was registered, permanently wedging range sync.
    const gloasConfig = createBeaconConfig(
      {
        ...defaultChainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
      },
      Buffer.alloc(32, 0)
    );
    const chain = getMockedBeaconChain();
    chain.getHeadState.mockImplementation(() => {
      throw new Error("headState does not exist for head root=0x00 slot=64");
    });
    const rangeSync = getRangeSync(chain, gloasConfig);

    expect(() => rangeSync.addPeer(validPeerIdStr, localStatus, remoteStatus)).not.toThrow();

    expect(chain.getHeadState).toHaveBeenCalledOnce();
    expect(rangeSync.getSyncChainsDebugState()).toHaveLength(1);
  });
});
