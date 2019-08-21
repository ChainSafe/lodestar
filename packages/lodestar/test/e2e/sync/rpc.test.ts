import {expect} from "chai";
import sinon from "sinon";
import BN from "bn.js";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {Method} from "../../../src/constants";
import {SyncRpc} from "../../../src/network/libp2p/syncRpc";
import {ReputationStore} from "../../../src/sync/reputation";
import {Libp2pNetwork} from "../../../src/network";
import {BeaconDb, LevelDbController} from "../../../src/db";

import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../unit/network/libp2p/util";
import {WinstonLogger} from "../../../src/logger";
import {INetworkOptions} from "../../../src/network/options";
import {BeaconMetrics} from "../../../src/metrics";

const multiaddr = "/ip4/127.0.0.1/tcp/0";
const opts: INetworkOptions = {
  maxPeers: 1,
  bootnodes: [],
  rpcTimeout: 5000,
  connectTimeout: 5000,
  disconnectTimeout: 5000,
  multiaddrs: [],
};

describe("[sync] rpc", () => {
  const sandbox = sinon.createSandbox();
  let logger = new WinstonLogger();
  const metrics = new BeaconMetrics({enabled: false, timeout: 5000, pushGateway: false});

  let rpcA: SyncRpc, netA: Libp2pNetwork, repsA: ReputationStore;
  let rpcB: SyncRpc, netB: Libp2pNetwork, repsB: ReputationStore;
  beforeEach(async () => {
    netA = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr), logger, metrics});
    netB = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr), logger, metrics});
    await Promise.all([
      netA.start(),
      netB.start(),
    ]);
    repsA = new ReputationStore();
    const chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: new BN(0),
    });
    chain.latestState = null;
    rpcA = new SyncRpc({}, {
      config,
      db: new BeaconDb({
        config,
        controller: sandbox.createStubInstance(LevelDbController),
      }),
      chain,
      network: netA,
      reps: repsA,
      logger,
    });
    repsB = new ReputationStore();
    rpcB = new SyncRpc({}, {
      config,
      db: new BeaconDb({
        config,
        controller: sandbox.createStubInstance(LevelDbController),
      }),
      chain,
      network: netB,
      reps: repsB,
      logger: logger
    })
    ;
    netA.on("request", rpcA.onRequest.bind(rpcA));
    netB.on("request", rpcB.onRequest.bind(rpcB));
    await Promise.all([
      rpcA.start(),
      rpcB.start(),
    ]);
  });
  afterEach(async () => {
    await Promise.all([
      netA.stop(),
      netB.stop(),
    ]);
    await Promise.all([
      rpcA.stop(),
      rpcB.stop(),
    ]);
    netA.removeListener("request", rpcA.onRequest.bind(rpcA));
    netB.removeListener("request", rpcB.onRequest.bind(rpcB));
  });

  it("hello handshake on peer connect", async function () {
    this.timeout(6000);
    await netA.connect(netB.peerInfo);
    await Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    expect(netA.hasPeer(netB.peerInfo)).to.equal(true);
    expect(netB.hasPeer(netA.peerInfo)).to.equal(true);
    await new Promise((resolve) => {
      netA.once("request", resolve);
      netB.once("request", resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(repsA.get(netB.peerInfo.id.toB58String()).latestHello).to.not.equal(null);
    expect(repsB.get(netA.peerInfo.id.toB58String()).latestHello).to.not.equal(null);
  });

  it("goodbye on rpc stop", async function () {
    this.timeout(6000);
    await netA.connect(netB.peerInfo);
    await Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    await new Promise((resolve) => {
      netA.once("request", resolve);
      netB.once("request", resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const goodbyeEvent = new Promise((resolve) => netB.once("request", (_, method) => resolve(method)));
    await rpcA.stop();
    const goodbye = await goodbyeEvent;
    expect(goodbye).to.equal(Method.Goodbye);
  });
});
