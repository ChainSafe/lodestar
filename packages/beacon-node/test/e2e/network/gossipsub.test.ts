import {describe, it, expect, afterEach, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {sleep} from "@lodestar/utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {Network} from "../../../src/network/index.js";
import {GossipType, GossipHandlers, GossipHandlerParamGeneric} from "../../../src/network/gossip/index.js";
import {getNetworkForTest} from "../../utils/networkWithMockDb.js";
import {connect, onPeerConnect} from "../../utils/network.js";

describe("gossipsub / main thread", function () {
  vi.setConfig({testTimeout: 3000});

  runTests({useWorker: false});
});

/**
 * This is nice to have to investigate networking issue in local environment.
 * Since we use vitest to run tests in parallel, including this causes the test to be unstable.
 * See https://github.com/ChainSafe/lodestar/issues/6358
 */
describe.skip("gossipsub / worker", function () {
  vi.setConfig({testTimeout: 3000});

  runTests({useWorker: true});
});

function runTests({useWorker}: {useWorker: boolean}): void {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  // Schedule all forks at ALTAIR_FORK_EPOCH to avoid generating the pubkeys cache
  const config = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 1,
    CAPELLA_FORK_EPOCH: 1,
  });
  const START_SLOT = computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH);

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
    const onVoluntaryExitPromise = new Promise<Uint8Array>((resolve) => {
      onVoluntaryExit = resolve;
    });

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
    let onBlsToExecutionChange: (blsToExec: Uint8Array) => void;
    const onBlsToExecutionChangePromise = new Promise<Uint8Array>((resolve) => {
      onBlsToExecutionChange = resolve;
    });

    const {netA, netB} = await mockModules({
      [GossipType.bls_to_execution_change]: async ({
        gossipData,
      }: GossipHandlerParamGeneric<GossipType.bls_to_execution_change>) => {
        onBlsToExecutionChange(gossipData.serializedData);
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
    await netA.publishBlsToExecutionChange(blsToExec);

    const receivedblsToExec = await onBlsToExecutionChangePromise;
    expect(Buffer.from(receivedblsToExec)).toEqual(
      Buffer.from(ssz.capella.SignedBLSToExecutionChange.serialize(blsToExec))
    );
  });

  it("Publish and receive an attesterSlashing", async function () {
    let onAttesterSlashingChange: (payload: Uint8Array) => void;
    const onAttesterSlashingChangePromise = new Promise<Uint8Array>((resolve) => {
      onAttesterSlashingChange = resolve;
    });

    const {netA, netB} = await mockModules({
      [GossipType.attester_slashing]: async ({gossipData}: GossipHandlerParamGeneric<GossipType.attester_slashing>) => {
        onAttesterSlashingChange(gossipData.serializedData);
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

    const attesterSlashing = ssz.phase0.AttesterSlashing.defaultValue();
    await netA.publishAttesterSlashing(attesterSlashing);

    const received = await onAttesterSlashingChangePromise;
    expect(Buffer.from(received)).toEqual(Buffer.from(ssz.phase0.AttesterSlashing.serialize(attesterSlashing)));
  });

  it("Publish and receive a proposerSlashing", async function () {
    let onProposerSlashingChange: (payload: Uint8Array) => void;
    const onProposerSlashingChangePromise = new Promise<Uint8Array>((resolve) => {
      onProposerSlashingChange = resolve;
    });

    const {netA, netB} = await mockModules({
      [GossipType.proposer_slashing]: async ({gossipData}: GossipHandlerParamGeneric<GossipType.proposer_slashing>) => {
        onProposerSlashingChange(gossipData.serializedData);
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

    const proposerSlashing = ssz.phase0.ProposerSlashing.defaultValue();
    await netA.publishProposerSlashing(proposerSlashing);

    const received = await onProposerSlashingChangePromise;
    expect(Buffer.from(received)).toEqual(Buffer.from(ssz.phase0.ProposerSlashing.serialize(proposerSlashing)));
  });

  it("Publish and receive a LightClientOptimisticUpdate", async function () {
    let onLightClientOptimisticUpdate: (ou: Uint8Array) => void;
    const onLightClientOptimisticUpdatePromise = new Promise<Uint8Array>((resolve) => {
      onLightClientOptimisticUpdate = resolve;
    });

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
    const onLightClientFinalityUpdatePromise = new Promise<Uint8Array>((resolve) => {
      onLightClientFinalityUpdate = resolve;
    });

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
