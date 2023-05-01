import sinon from "sinon";
import {expect} from "chai";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {sleep} from "@lodestar/utils";

import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {getReqRespHandlers, Network, NetworkInitModules} from "../../../src/network/index.js";
import {defaultNetworkOptions, NetworkOptions} from "../../../src/network/options.js";
import {GossipType, GossipHandlers} from "../../../src/network/gossip/index.js";

import {MockBeaconChain, zeroProtoBlock} from "../../utils/mocks/chain/chain.js";
import {createNetworkModules, connect, onPeerConnect} from "../../utils/network.js";
import {generateState} from "../../utils/state.js";
import {StubbedBeaconDb} from "../../utils/stub/index.js";
import {testLogger} from "../../utils/logger.js";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

const opts: NetworkOptions = {
  ...defaultNetworkOptions,
  maxPeers: 1,
  targetPeers: 1,
  bootMultiaddrs: [],
  localMultiaddrs: [],
  discv5FirstQueryDelayMs: 0,
  discv5: null,
  skipParamsLog: true,
};

// Schedule all forks at ALTAIR_FORK_EPOCH to avoid generating the pubkeys cache
/* eslint-disable @typescript-eslint/naming-convention */
const config = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: 1,
  BELLATRIX_FORK_EPOCH: 1,
  CAPELLA_FORK_EPOCH: 1,
});
const START_SLOT = computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH);

describe("gossipsub", function () {
  if (this.timeout() < 15 * 1000) this.timeout(15 * 1000);
  this.retries(2); // This test fail sometimes, with a 5% rate.

  const logger = testLogger();

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function mockModules(gossipHandlersPartial?: Partial<GossipHandlers>) {
    const controller = new AbortController();

    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });

    const beaconConfig = createBeaconConfig(config, state.genesisValidatorsRoot);
    const chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: BigInt(0),
      state,
      config: beaconConfig,
    });

    chain.forkChoice.getHead = () => {
      return {
        ...zeroProtoBlock,
        slot: START_SLOT,
      };
    };

    const db = new StubbedBeaconDb(config);
    const reqRespHandlers = getReqRespHandlers({db, chain});
    const gossipHandlers = gossipHandlersPartial as GossipHandlers;

    const loggerA = testLogger("A");
    const loggerB = testLogger("B");

    const modules: Omit<NetworkInitModules, "opts" | "peerId" | "logger"> = {
      config: beaconConfig,
      chain,
      reqRespHandlers,
      gossipHandlers,
      signal: controller.signal,
      metrics: null,
    };
    const netA = await Network.init({
      ...modules,
      ...(await createNetworkModules(multiaddr, undefined, opts)),
      logger: loggerA,
    });
    const netB = await Network.init({
      ...modules,
      ...(await createNetworkModules(multiaddr, undefined, opts)),
      logger: loggerB,
    });

    afterEachCallbacks.push(async () => {
      await chain.close();
      controller.abort();
      await Promise.all([netA.close(), netB.close()]);
      sinon.restore();
    });

    return {netA, netB, chain, controller};
  }

  it("Publish and receive a voluntaryExit", async function () {
    let onVoluntaryExit: (ve: Uint8Array) => void;
    const onVoluntaryExitPromise = new Promise<Uint8Array>((resolve) => (onVoluntaryExit = resolve));

    const {netA, netB, controller} = await mockModules({
      [GossipType.voluntary_exit]: async ({serializedData}) => {
        onVoluntaryExit(serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!controller.signal.aborted) {
      await sleep(500);
      const topicStr = netA["gossipsub"].getTopics()[0];
      if (topicStr && netA["gossipsub"].getMeshPeers(topicStr).length > 0) {
        break;
      }
    }

    const voluntaryExit = ssz.phase0.SignedVoluntaryExit.defaultValue();
    await netA.gossip.publishVoluntaryExit(voluntaryExit);

    const receivedVoluntaryExit = await onVoluntaryExitPromise;
    expect(receivedVoluntaryExit).to.deep.equal(ssz.phase0.SignedVoluntaryExit.serialize(voluntaryExit));
  });

  it("Publish and receive 1000 voluntaryExits", async function () {
    const receivedVoluntaryExits: Uint8Array[] = [];

    const {netA, netB, controller} = await mockModules({
      [GossipType.voluntary_exit]: async ({serializedData}) => {
        receivedVoluntaryExits.push(serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!controller.signal.aborted) {
      await sleep(500);
      const topicStr = netA["gossipsub"].getTopics()[0];
      if (topicStr && netA["gossipsub"].getMeshPeers(topicStr).length > 0) {
        break;
      }
    }

    const msgCount = 1000;

    for (let i = 0; i < msgCount; i++) {
      const voluntaryExit = ssz.phase0.SignedVoluntaryExit.defaultValue();
      voluntaryExit.message.epoch = i;
      netA.gossip.publishVoluntaryExit(voluntaryExit).catch((e: Error) => {
        logger.error("Error on publishVoluntaryExit", {}, e);
      });
    }

    // Wait to receive all the messages. A timeout error will happen otherwise
    while (!controller.signal.aborted) {
      await sleep(500);
      if (receivedVoluntaryExits.length >= msgCount) {
        break;
      }
    }
  });

  it("Publish and receive a blsToExecutionChange", async function () {
    let onBlsToExecutionChange: (blsToExec: Uint8Array) => void;
    const onBlsToExecutionChangePromise = new Promise<Uint8Array>((resolve) => (onBlsToExecutionChange = resolve));

    const {netA, netB, controller} = await mockModules({
      [GossipType.bls_to_execution_change]: async ({serializedData}) => {
        onBlsToExecutionChange(serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!controller.signal.aborted) {
      await sleep(500);
      const topicStr = netA["gossipsub"].getTopics()[0];
      if (topicStr && netA["gossipsub"].getMeshPeers(topicStr).length > 0) {
        break;
      }
    }

    const blsToExec = ssz.capella.SignedBLSToExecutionChange.defaultValue();
    await netA.gossip.publishBlsToExecutionChange(blsToExec);

    const receivedblsToExec = await onBlsToExecutionChangePromise;
    expect(receivedblsToExec).to.deep.equal(ssz.capella.SignedBLSToExecutionChange.serialize(blsToExec));
  });

  it("Publish and receive a LightClientOptimisticUpdate", async function () {
    let onLightClientOptimisticUpdate: (ou: Uint8Array) => void;
    const onLightClientOptimisticUpdatePromise = new Promise<Uint8Array>(
      (resolve) => (onLightClientOptimisticUpdate = resolve)
    );

    const {netA, netB, controller} = await mockModules({
      [GossipType.light_client_optimistic_update]: async ({serializedData}) => {
        onLightClientOptimisticUpdate(serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!controller.signal.aborted) {
      await sleep(500);
      const topicStr = netA["gossipsub"].getTopics()[0];
      if (topicStr && netA["gossipsub"].getMeshPeers(topicStr).length > 0) {
        break;
      }
    }

    const lightClientOptimisticUpdate = ssz.capella.LightClientOptimisticUpdate.defaultValue();
    lightClientOptimisticUpdate.signatureSlot = START_SLOT;
    await netA.gossip.publishLightClientOptimisticUpdate(lightClientOptimisticUpdate);

    const optimisticUpdate = await onLightClientOptimisticUpdatePromise;
    expect(optimisticUpdate).to.deep.equal(
      ssz.capella.LightClientOptimisticUpdate.serialize(lightClientOptimisticUpdate)
    );
  });

  it("Publish and receive a LightClientFinalityUpdate", async function () {
    let onLightClientFinalityUpdate: (fu: Uint8Array) => void;
    const onLightClientFinalityUpdatePromise = new Promise<Uint8Array>(
      (resolve) => (onLightClientFinalityUpdate = resolve)
    );

    const {netA, netB, controller} = await mockModules({
      [GossipType.light_client_finality_update]: async ({serializedData}) => {
        onLightClientFinalityUpdate(serializedData);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);

    await netA.subscribeGossipCoreTopics();
    await netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!controller.signal.aborted) {
      await sleep(500);
      const topicStr = netA["gossipsub"].getTopics()[0];
      if (topicStr && netA["gossipsub"].getMeshPeers(topicStr).length > 0) {
        break;
      }
    }

    const lightClientFinalityUpdate = ssz.capella.LightClientFinalityUpdate.defaultValue();
    lightClientFinalityUpdate.signatureSlot = START_SLOT;
    await netA.gossip.publishLightClientFinalityUpdate(lightClientFinalityUpdate);

    const optimisticUpdate = await onLightClientFinalityUpdatePromise;
    expect(optimisticUpdate).to.deep.equal(ssz.capella.LightClientFinalityUpdate.serialize(lightClientFinalityUpdate));
  });
});
