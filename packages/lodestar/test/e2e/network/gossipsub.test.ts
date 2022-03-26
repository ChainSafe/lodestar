import sinon from "sinon";
import {expect} from "chai";
import {AbortController} from "@chainsafe/abort-controller";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/default";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";

import {getReqRespHandlers, Network} from "../../../src/network";
import {defaultNetworkOptions, INetworkOptions} from "../../../src/network/options";
import {GossipType, GossipHandlers} from "../../../src/network/gossip";

import {generateEmptySignedBlock} from "../../utils/block";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../utils/network";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";
import {connect, onPeerConnect} from "../../utils/network";
import {testLogger} from "../../utils/logger";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

const opts: INetworkOptions = {
  ...defaultNetworkOptions,
  maxPeers: 1,
  targetPeers: 1,
  bootMultiaddrs: [],
  localMultiaddrs: [],
  discv5FirstQueryDelayMs: 0,
  discv5: null,
};

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

    const block = generateEmptySignedBlock();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });

    const beaconConfig = createIBeaconConfig(config, state.genesisValidatorsRoot);
    const chain = new MockBeaconChain({genesisTime: 0, chainId: 0, networkId: BigInt(0), state, config: beaconConfig});
    const db = new StubbedBeaconDb(config);
    const reqRespHandlers = getReqRespHandlers({db, chain});
    const gossipHandlers = gossipHandlersPartial as GossipHandlers;

    const [libp2pA, libp2pB] = await Promise.all([createNode(multiaddr), createNode(multiaddr)]);
    const loggerA = testLogger("A");
    const loggerB = testLogger("B");

    const modules = {
      config: beaconConfig,
      chain,
      db,
      reqRespHandlers,
      gossipHandlers,
      signal: controller.signal,
      metrics: null,
    };
    const netA = new Network(opts, {...modules, libp2p: libp2pA, logger: loggerA});
    const netB = new Network(opts, {...modules, libp2p: libp2pB, logger: loggerB});

    await Promise.all([netA.start(), netB.start()]);

    afterEachCallbacks.push(async () => {
      chain.close();
      controller.abort();
      await Promise.all([netA.stop(), netB.stop()]);
      sinon.restore();
    });

    return {netA, netB, chain, controller};
  }

  it("Publish and receive a voluntaryExit", async function () {
    let onVoluntaryExit: (ve: phase0.SignedVoluntaryExit) => void;
    const onVoluntaryExitPromise = new Promise<phase0.SignedVoluntaryExit>((resolve) => (onVoluntaryExit = resolve));

    const {netA, netB, controller} = await mockModules({
      [GossipType.voluntary_exit]: async (voluntaryExit) => {
        onVoluntaryExit(voluntaryExit);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);

    netA.subscribeGossipCoreTopics();
    netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!controller.signal.aborted) {
      await sleep(500);
      const topicStr = Array.from(netA.gossip.mesh.keys())[0];
      const peersOnTopic = netA.gossip.mesh.get(topicStr);
      if (peersOnTopic && peersOnTopic?.size > 0) {
        break;
      }
    }

    const voluntaryExit = ssz.phase0.SignedVoluntaryExit.defaultValue();
    await netA.gossip.publishVoluntaryExit(voluntaryExit);

    const receivedVoluntaryExit = await onVoluntaryExitPromise;
    expect(receivedVoluntaryExit).to.deep.equal(voluntaryExit);
  });

  it("Publish and receive 1000 voluntaryExits", async function () {
    const receivedVoluntaryExits: phase0.SignedVoluntaryExit[] = [];

    const {netA, netB, controller} = await mockModules({
      [GossipType.voluntary_exit]: async (voluntaryExit) => {
        receivedVoluntaryExits.push(voluntaryExit);
      },
    });

    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);

    netA.subscribeGossipCoreTopics();
    netB.subscribeGossipCoreTopics();

    // Wait to have a peer connected to a topic
    while (!controller.signal.aborted) {
      await sleep(500);
      const topicStr = Array.from(netA.gossip.mesh.keys())[0];
      const peersOnTopic = netA.gossip.mesh.get(topicStr);
      if (peersOnTopic && peersOnTopic?.size > 0) {
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
});
