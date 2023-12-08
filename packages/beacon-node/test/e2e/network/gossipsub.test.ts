import {describe, it, expect, afterEach} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {sleep} from "@lodestar/utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {Network} from "../../../src/network/index.js";
import {GossipType, GossipHandlers, GossipHandlerParamGeneric} from "../../../src/network/gossip/index.js";
import {connect, onPeerConnect, getNetworkForTest} from "../../utils/network.js";

describe(
  "gossipsub / main thread",
  function () {
    runTests({useWorker: false});
  },
  {timeout: 3000}
);

describe(
  "gossipsub / worker",
  function () {
    runTests({useWorker: true});
  },
  {timeout: 10_000}
);

/* eslint-disable mocha/no-top-level-hooks */

function runTests({useWorker}: {useWorker: boolean}): void {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  // Schedule all forks at ALTAIR_FORK_EPOCH to avoid generating the pubkeys cache
  /* eslint-disable @typescript-eslint/naming-convention */
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 1,
    CAPELLA_FORK_EPOCH: 1,
  });
  const START_SLOT = computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH);

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function mockModules(gossipHandlersPartial?: Partial<GossipHandlers>) {
    const [netA, closeA] = await getNetworkForTest(`gossipsub-${useWorker ? "worker" : "main"}-A`, config, {
      opts: {useWorker},
      gossipHandlersPartial,
    });
    const [netB, closeB] = await getNetworkForTest(`gossipsub-${useWorker ? "worker" : "main"}-B`, config, {
      opts: {useWorker},
      gossipHandlersPartial,
    });

    afterEachCallbacks.push(async () => {
      await closeA();
      await closeB();
    });

    return {netA, netB};
  }

  it("Publish and receive a voluntaryExit", async function () {
    let onVoluntaryExit: (ve: Uint8Array) => void;
    const onVoluntaryExitPromise = new Promise<Uint8Array>((resolve) => (onVoluntaryExit = resolve));

    const {netA, netB} = await mockModules({
      [GossipType.voluntary_exit]: async ({gossipData}: GossipHandlerParamGeneric<GossipType.voluntary_exit>) => {
        onVoluntaryExit(gossipData.serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
    expect(netA.getConnectedPeerCount()).toBe(1);
    expect(netB.getConnectedPeerCount()).toBe(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!netA.closed) {
      await sleep(500);
      if (await hasSomeMeshPeer(netA)) {
        break;
      }
    }

    const voluntaryExit = ssz.phase0.SignedVoluntaryExit.defaultValue();
    voluntaryExit.message.epoch = config.ALTAIR_FORK_EPOCH;
    await netA.publishVoluntaryExit(voluntaryExit);

    const receivedVoluntaryExit = await onVoluntaryExitPromise;
    expect(Buffer.from(receivedVoluntaryExit)).toEqual(
      Buffer.from(ssz.phase0.SignedVoluntaryExit.serialize(voluntaryExit))
    );
  });

  it("Publish and receive a blsToExecutionChange", async function () {
    let onBLSToExecutionChange: (blsToExec: Uint8Array) => void;
    const onBLSToExecutionChangePromise = new Promise<Uint8Array>((resolve) => (onBLSToExecutionChange = resolve));

    const {netA, netB} = await mockModules({
      [GossipType.bls_to_execution_change]: async ({
        gossipData,
      }: GossipHandlerParamGeneric<GossipType.bls_to_execution_change>) => {
        onBLSToExecutionChange(gossipData.serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
    expect(netA.getConnectedPeerCount()).toBe(1);
    expect(netB.getConnectedPeerCount()).toBe(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!netA.closed) {
      await sleep(500);
      if (await hasSomeMeshPeer(netA)) {
        break;
      }
    }

    const blsToExec = ssz.capella.SignedBLSToExecutionChange.defaultValue();
    await netA.publishBLSToExecutionChange(blsToExec);

    const receivedblsToExec = await onBLSToExecutionChangePromise;
    expect(Buffer.from(receivedblsToExec)).toEqual(
      Buffer.from(ssz.capella.SignedBLSToExecutionChange.serialize(blsToExec))
    );
  });

  it("Publish and receive a LightClientOptimisticUpdate", async function () {
    let onLightClientOptimisticUpdate: (ou: Uint8Array) => void;
    const onLightClientOptimisticUpdatePromise = new Promise<Uint8Array>(
      (resolve) => (onLightClientOptimisticUpdate = resolve)
    );

    const {netA, netB} = await mockModules({
      [GossipType.light_client_optimistic_update]: async ({
        gossipData,
      }: GossipHandlerParamGeneric<GossipType.light_client_optimistic_update>) => {
        onLightClientOptimisticUpdate(gossipData.serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
    expect(netA.getConnectedPeerCount()).toBe(1);
    expect(netB.getConnectedPeerCount()).toBe(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!netA.closed) {
      await sleep(500);
      if (await hasSomeMeshPeer(netA)) {
        break;
      }
    }

    const lightClientOptimisticUpdate = ssz.capella.LightClientOptimisticUpdate.defaultValue();
    lightClientOptimisticUpdate.signatureSlot = START_SLOT;
    await netA.publishLightClientOptimisticUpdate(lightClientOptimisticUpdate);

    const optimisticUpdate = await onLightClientOptimisticUpdatePromise;
    expect(Buffer.from(optimisticUpdate)).toEqual(
      Buffer.from(ssz.capella.LightClientOptimisticUpdate.serialize(lightClientOptimisticUpdate))
    );
  });

  it("Publish and receive a LightClientFinalityUpdate", async function () {
    let onLightClientFinalityUpdate: (fu: Uint8Array) => void;
    const onLightClientFinalityUpdatePromise = new Promise<Uint8Array>(
      (resolve) => (onLightClientFinalityUpdate = resolve)
    );

    const {netA, netB} = await mockModules({
      [GossipType.light_client_finality_update]: async ({
        gossipData,
      }: GossipHandlerParamGeneric<GossipType.light_client_finality_update>) => {
        onLightClientFinalityUpdate(gossipData.serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
    expect(netA.getConnectedPeerCount()).toBe(1);
    expect(netB.getConnectedPeerCount()).toBe(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!netA.closed) {
      await sleep(500);
      if (await hasSomeMeshPeer(netA)) {
        break;
      }
    }

    const lightClientFinalityUpdate = ssz.capella.LightClientFinalityUpdate.defaultValue();
    lightClientFinalityUpdate.signatureSlot = START_SLOT;
    await netA.publishLightClientFinalityUpdate(lightClientFinalityUpdate);

    const optimisticUpdate = await onLightClientFinalityUpdatePromise;
    expect(Buffer.from(optimisticUpdate)).toEqual(
      Buffer.from(ssz.capella.LightClientFinalityUpdate.serialize(lightClientFinalityUpdate))
    );
  });
}

async function hasSomeMeshPeer(net: Network): Promise<boolean> {
  return Object.values(await net.dumpMeshPeers()).some((peers) => peers.length > 0);
}
