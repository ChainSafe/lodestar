import {describe, it, afterEach, beforeEach, expect, vi} from "vitest";
import {PeerId} from "@libp2p/interface";
import {multiaddr} from "@multiformats/multiaddr";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {SignableENR} from "@chainsafe/enr";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";
import {Network, NetworkInitModules, getReqRespHandlers} from "../../../src/network/index.js";
import {defaultNetworkOptions, NetworkOptions} from "../../../src/network/options.js";
import {createNetworkModules, onPeerConnect} from "../../utils/network.js";
import {generateState, zeroProtoBlock} from "../../utils/state.js";
import {testLogger} from "../../utils/logger.js";
import {GossipHandlers} from "../../../src/network/gossip/index.js";
import {memoOnce} from "../../utils/cache.js";

let port = 9000;
const mu = "/ip4/127.0.0.1/tcp/0";

// https://github.com/ChainSafe/lodestar/issues/5967
describe.skip("mdns", function () {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    await Promise.all(afterEachCallbacks.map((cb) => cb()));
    afterEachCallbacks.splice(0, afterEachCallbacks.length);
  });

  let controller: AbortController;
  beforeEach(() => {
    controller = new AbortController();
  });
  afterEach(() => controller.abort());

  async function getOpts(peerId: PeerId): Promise<NetworkOptions> {
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
        enr: enr.encodeTxt(),
        bindAddrs: {
          ip4: bindAddrUdp,
        },
        bootEnrs: [],
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
    const beaconConfig = createBeaconConfig(config, state.genesisValidatorsRoot);
    return {block, state, config: beaconConfig};
  });

  async function createTestNode(nodeName: string) {
    const {config} = getStaticData();
    const chain = getMockedBeaconChain();

    vi.spyOn(chain.forkChoice, "getHead").mockReturnValue({
      ...zeroProtoBlock,
      slot: computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH),
    });

    const db = getMockedBeaconDb();
    const gossipHandlers = {} as GossipHandlers;

    const peerId = await createSecp256k1PeerId();
    const logger = testLogger(nodeName);

    const opts = await getOpts(peerId);

    const modules: Omit<NetworkInitModules, "opts" | "peerId" | "logger"> = {
      config,
      chain,
      db,
      getReqRespHandler: getReqRespHandlers({db, chain}),
      gossipHandlers,
      metrics: null,
    };

    const network = await Network.init({
      ...modules,
      ...(await createNetworkModules(mu, peerId, {...opts, mdns: true})),
      logger,
    });

    afterEachCallbacks.push(async () => {
      await chain.close();
      await network.close();
      controller.abort();
      vi.clearAllMocks();
    });

    return {network, chain};
  }

  async function createTestNodesAB() {
    return Promise.all([createTestNode("mdns-A"), createTestNode("mdns-B")]);
  }

  it("should connect two peers on a LAN", async function () {
    const [{network: netA}, {network: netB}] = await createTestNodesAB();
    await Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    expect(netA.getConnectedPeerCount()).toBe(1);
    expect(netB.getConnectedPeerCount()).toBe(1);
  });
});
