import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

import {Method} from "../../../src/constants";
import {SyncReqResp} from "../../../src/sync/reqResp";
import {ReputationStore} from "../../../src/sync/IReputation";
import {Libp2pNetwork} from "../../../src/network";
import {BeaconDb} from "../../../src/db";
import Libp2p from "libp2p";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../unit/network/util";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {INetworkOptions} from "../../../src/network/options";
import {BeaconMetrics} from "../../../src/metrics";
import {generateState} from "../../utils/state";
import {BlockRepository, ChainRepository, StateRepository, BlockArchiveRepository} from "../../../src/db/api/beacon/repositories";
import { IGossipMessageValidator } from "../../../src/network/gossip/interface";
import {generateEmptySignedBlock} from "../../utils/block";

const multiaddr = "/ip4/127.0.0.1/tcp/0";
const opts: INetworkOptions = {
  maxPeers: 1,
  bootnodes: [],
  rpcTimeout: 5000,
  connectTimeout: 5000,
  disconnectTimeout: 5000,
  multiaddrs: [],
};

describe("[sync] rpc", function () {
  this.timeout(20000);
  const sandbox = sinon.createSandbox();
  const logger = new WinstonLogger();
  logger.silent = true;
  const metrics = new BeaconMetrics({enabled: false, timeout: 5000, pushGateway: false}, {logger});

  let rpcA: SyncReqResp, netA: Libp2pNetwork, repsA: ReputationStore;
  let rpcB: SyncReqResp, netB: Libp2pNetwork, repsB: ReputationStore;
  const validator: IGossipMessageValidator = {} as unknown as IGossipMessageValidator;
  beforeEach(async () => {
    netA = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator});
    netB = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator});
    await Promise.all([
      netA.start(),
      netB.start(),
    ]);
    repsA = new ReputationStore();
    const chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: 0n,
    });
    const state = generateState();
    const block = generateEmptySignedBlock();
    state.finalizedCheckpoint = {
      epoch: 0,
      root: config.types.BeaconBlock.hashTreeRoot(block.message),
    };
    // @ts-ignore
    const db = {
      state: sandbox.createStubInstance(StateRepository),
      chain: sandbox.createStubInstance(ChainRepository),
      block: sandbox.createStubInstance(BlockRepository),
      blockArchive: sandbox.createStubInstance(BlockArchiveRepository),
    } as BeaconDb;
    // @ts-ignore
    db.state.get.resolves(state);
    // @ts-ignore
    db.chain.getChainHeadSlot.resolves(0);
    // @ts-ignore
    db.block.getChainHead.resolves(block);
    // @ts-ignore
    db.block.get.resolves(block);
    // @ts-ignore
    db.blockArchive.get.resolves(block);
    chain.latestState = state;
    rpcA = new SyncReqResp({}, {
      config,
      db,
      chain,
      network: netA,
      reps: repsA,
      logger,
    });
    repsB = new ReputationStore();
    rpcB = new SyncReqResp({}, {
      config,
      db,
      chain,
      network: netB,
      reps: repsB,
      logger: logger
    })
    ;
    netA.reqResp.on("request", rpcA.onRequest.bind(rpcA));
    netB.reqResp.on("request", rpcB.onRequest.bind(rpcB));
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
    netA.reqResp.removeListener("request", rpcA.onRequest.bind(rpcA));
    netB.reqResp.removeListener("request", rpcB.onRequest.bind(rpcB));
  });

  it("hello handshake on peer connect", async function () {
    this.timeout(6000);
    const connected = Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    expect(netA.hasPeer(netB.peerInfo)).to.equal(true);
    expect(netB.hasPeer(netA.peerInfo)).to.equal(true);
    await new Promise((resolve) => {
      netA.reqResp.once("request", resolve);
      netB.reqResp.once("request", resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(repsA.get(netB.peerInfo.id.toB58String()).latestStatus).to.not.equal(null);
    expect(repsB.get(netA.peerInfo.id.toB58String()).latestStatus).to.not.equal(null);
  });

  it("goodbye on rpc stop", async function () {
    this.timeout(6000);
    const connected = Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    await new Promise((resolve) => {
      netA.reqResp.once("request", resolve);
      netB.reqResp.once("request", resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const goodbyeEvent = new Promise((resolve) => netB.reqResp.once("request", (_, method) => resolve(method)));
    await rpcA.stop();
    const goodbye = await goodbyeEvent;
    expect(goodbye).to.equal(Method.Goodbye);
  });
});
