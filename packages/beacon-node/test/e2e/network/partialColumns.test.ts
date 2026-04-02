import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {fulu, ssz} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {GossipHandlerParamGeneric, GossipHandlers, GossipType} from "../../../src/network/gossip/index.js";
import {Network} from "../../../src/network/index.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getNetworkForTestModules} from "../../utils/networkWithMockDb.js";
import {buildDataColumnSidecarFixture} from "../../utils/partialColumns.js";

describe("partial columns / main thread", () => {
  vi.setConfig({testTimeout: 15_000});

  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: Infinity,
  });
  const startSlot = 1;
  let controller: AbortController;

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];

  beforeEach(() => {
    controller = new AbortController();
  });

  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  async function createAndConnectPartialNetworks(gossipHandlersPartial?: Partial<GossipHandlers>) {
    const modulesA = await getNetworkForTestModules("partial-columns-A", config, {
      startSlot,
      gossipHandlersPartial,
      opts: {enablePartialColumns: true, useWorker: false},
    });
    const modulesB = await getNetworkForTestModules("partial-columns-B", config, {
      startSlot,
      gossipHandlersPartial,
      opts: {enablePartialColumns: true, useWorker: false},
    });

    afterEachCallbacks.push(async () => {
      await modulesA.closeAll();
      await modulesB.closeAll();
    });
    const connected = Promise.all([onPeerConnect(modulesA.network), onPeerConnect(modulesB.network)]);
    await connect(modulesA.network, modulesB.network, controller.signal);
    await connected;

    controller.signal.addEventListener("abort", async () => {
      await modulesA.closeAll();
      await modulesB.closeAll();
    });

    return {modulesA, modulesB};
  }

  it("should send header-only partial messages to partial-capable peers without falling back to full gossip", async () => {
    let fullColumnGossipCount = 0;
    let resolvePartialSidecar: ((partialSidecar: fulu.PartialDataColumnSidecar) => void) | undefined;
    const partialSidecarPromise = new Promise<fulu.PartialDataColumnSidecar>((resolve) => {
      resolvePartialSidecar = resolve;
    });
    const {modulesA, modulesB} = await createAndConnectPartialNetworks({
      [GossipType.data_column_sidecar]: async (_params: GossipHandlerParamGeneric<GossipType.data_column_sidecar>) => {
        fullColumnGossipCount++;
      },
      [GossipType.partial_data_column_sidecar]: async ({
        gossipData,
      }: GossipHandlerParamGeneric<GossipType.partial_data_column_sidecar>) => {
        resolvePartialSidecar?.(ssz.fulu.PartialDataColumnSidecar.deserialize(gossipData.serializedData));
      },
    });
    const netA = modulesA.network;
    const chainB = modulesB.chain;

    await netA.subscribeGossipCoreTopics();
    await modulesB.network.subscribeGossipCoreTopics();

    while (!netA.closed) {
      await sleep(200);
      if (await hasSomeMeshPeer(netA)) {
        break;
      }
    }
    await sleep(500);

    const blockSlot = chainB.clock.currentSlot;
    const columnIndex = chainB.custodyConfig.sampledColumns[0];

    if (columnIndex === undefined) {
      expect.fail("Expected at least one sampled column in the test network");
    }

    const sidecar = buildDataColumnSidecarFixture({
      chainConfig: config,
      slot: blockSlot,
      parentRoot: ssz.phase0.BeaconBlockHeader.hashTreeRoot(ssz.phase0.BeaconBlockHeader.defaultValue()),
      proposerIndex: 0,
      columnIndex,
    });

    await netA.publishDataColumnSidecar(sidecar, {publishPartial: true});

    const partialSidecar = await partialSidecarPromise;

    expect(fullColumnGossipCount).toBe(0);
    expect(partialSidecar.header).toHaveLength(1);
    expect(partialSidecar.cellsPresentBitmap.toBoolArray()).toEqual([]);
    expect(partialSidecar.partialColumn).toEqual([]);
    expect(partialSidecar.kzgProofs).toEqual([]);
    expect(
      ssz.fulu.PartialDataColumnHeader.equals(partialSidecar.header[0], {
        kzgCommitments: sidecar.kzgCommitments,
        signedBlockHeader: sidecar.signedBlockHeader,
        kzgCommitmentsInclusionProof: sidecar.kzgCommitmentsInclusionProof,
      })
    ).toBe(true);
  });
});

async function hasSomeMeshPeer(net: Network): Promise<boolean> {
  return Object.values(await net.dumpMeshPeers()).some((peers) => peers.length > 0);
}
