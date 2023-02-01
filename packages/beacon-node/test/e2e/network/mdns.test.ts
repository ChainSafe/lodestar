import sinon from "sinon";
import {expect} from "chai";

import {PeerId} from "@libp2p/interface-peer-id";
import {multiaddr} from "@multiformats/multiaddr";
import {SignableENR} from "@chainsafe/discv5";
import {createIBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";

import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Network, getReqRespHandlers} from "../../../src/network/index.js";
import {defaultNetworkOptions, INetworkOptions} from "../../../src/network/options.js";

import {MockBeaconChain, zeroProtoBlock} from "../../utils/mocks/chain/chain.js";
import {createNode} from "../../utils/network.js";
import {generateState} from "../../utils/state.js";
import {StubbedBeaconDb} from "../../utils/stub/index.js";
import {onPeerConnect} from "../../utils/network.js";
import {testLogger} from "../../utils/logger.js";
import {GossipHandlers} from "../../../src/network/gossip/index.js";
import {memoOnce} from "../../utils/cache.js";

let port = 9000;
const mu = "/ip4/127.0.0.1/tcp/0";

describe("mdns", function () {
  this.timeout(50000);
  this.retries(2); // This test fail sometimes, with a 5% rate.

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  async function getOpts(peerId: PeerId): Promise<INetworkOptions> {
    const bindAddrUdp = `/ip4/0.0.0.0/udp/${port++}`;
    const enr = SignableENR.createFromPeerId(peerId);
    enr.setLocationMultiaddr(multiaddr(bindAddrUdp));

    return {
      ...defaultNetworkOptions,
      maxPeers: 1,
      targetPeers: 1,
      bootMultiaddrs: [],
      localMultiaddrs: [],
      discv5FirstQueryDelayMs: 0,
      discv5: {
        enr,
        bindAddr: bindAddrUdp,
        bootEnrs: [],
        enabled: true,
      },
    };
  }

  const getStaticData = memoOnce(() => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });
    const beaconConfig = createIBeaconConfig(config, state.genesisValidatorsRoot);
    return {block, state, config: beaconConfig};
  });

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createTestNode(nodeName: string) {
    const {state, config} = getStaticData();
    const chain = new MockBeaconChain({genesisTime: 0, chainId: 0, networkId: BigInt(0), state, config});

    chain.forkChoice.getHead = () => {
      return {
        ...zeroProtoBlock,
        slot: computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH),
      };
    };

    const db = new StubbedBeaconDb(config);
    const reqRespHandlers = getReqRespHandlers({db, chain});
    const gossipHandlers = {} as GossipHandlers;

    const libp2p = await createNode(mu, undefined, {mdns: true});
    const logger = testLogger(nodeName);

    const opts = await getOpts(libp2p.peerId);

    const modules = {
      config,
      chain,
      db,
      reqRespHandlers,
      gossipHandlers,
      signal: controller.signal,
      metrics: null,
    };

    const network = new Network(opts, {...modules, libp2p, logger});
    await network.start();

    afterEachCallbacks.push(async () => {
      await chain.close();
      controller.abort();
      await network.stop();
      sinon.restore();
    });

    return {network, chain};
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createTestNodesAB() {
    return Promise.all([createTestNode("A"), createTestNode("B")]);
  }

  it("should connect two peers on a LAN", async function () {
    const [{network: netA}, {network: netB}] = await createTestNodesAB();
    await Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);
  });
});
