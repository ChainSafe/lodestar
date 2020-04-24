import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

import {Method} from "../../../src/constants";
import {ReputationStore} from "../../../src/sync/IReputation";
import {Libp2pNetwork} from "../../../src/network";
import {BeaconDb} from "../../../src/db";
import Libp2p from "libp2p";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {INetworkOptions} from "../../../src/network/options";
import {BeaconMetrics} from "../../../src/metrics";
import {generateState} from "../../utils/state";
import {
  BlockArchiveRepository,
  BlockRepository,
  ChainRepository,
  StateRepository
} from "../../../src/db/api/beacon/repositories";
import {IGossipMessageValidator} from "../../../src/network/gossip/interface";
import {generateEmptySignedBlock} from "../../utils/block";
import {BeaconBlocksByRangeRequest, BeaconBlocksByRootRequest} from "@chainsafe/lodestar-types";
import {BeaconReqRespHandler, IReqRespHandler} from "../../../src/sync/reqResp";
import {sleep} from "../../utils/sleep";
import {createNode} from "../../utils/network";

const multiaddr = "/ip4/127.0.0.1/tcp/0";
const opts: INetworkOptions = {
  maxPeers: 1,
  bootnodes: [],
  rpcTimeout: 5000,
  connectTimeout: 5000,
  disconnectTimeout: 5000,
  multiaddrs: [],
};

const block = generateEmptySignedBlock();
const BLOCK_SLOT = 2020;
block.message.slot = BLOCK_SLOT;
const block2 = generateEmptySignedBlock();
block2.message.slot = BLOCK_SLOT + 1;

describe("[sync] rpc", function () {
  this.timeout(20000);
  const sandbox = sinon.createSandbox();
  const logger = new WinstonLogger({level: "VERBOSE"});
  logger.silent = true;
  const metrics = new BeaconMetrics({enabled: false, timeout: 5000, pushGateway: false}, {logger});

  let rpcA: IReqRespHandler, netA: Libp2pNetwork, repsA: ReputationStore;
  let rpcB: IReqRespHandler, netB: Libp2pNetwork, repsB: ReputationStore;
  const validator: IGossipMessageValidator = {} as unknown as IGossipMessageValidator;

  beforeEach(async () => {
    const state = generateState();

    state.finalizedCheckpoint = {
      epoch: 0,
      root: config.types.BeaconBlock.hashTreeRoot(block.message),
    };
    const chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: 0n,
      state,
      config
    });
    netA = new Libp2pNetwork(
      opts,
      new ReputationStore(),
      {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator, chain}
    );
    netB = new Libp2pNetwork(
      opts,
      new ReputationStore(),
      {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator, chain}
    );
    await Promise.all([
      netA.start(),
      netB.start(),
    ]);
    repsA = new ReputationStore();

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
    // @ts-ignore
    db.blockArchive.getAllBetweenStream.returns(async function * () {
      yield block;
      yield block2;
    }());
    rpcA = new BeaconReqRespHandler({
      config,
      db,
      chain,
      network: netA,
      reputationStore: repsA,
      logger,
    });
    repsB = new ReputationStore();
    rpcB = new BeaconReqRespHandler({
      config,
      db,
      chain,
      network: netB,
      reputationStore: repsB,
      logger: logger
    })
    ;
    await Promise.all([
      rpcA.start(),
      rpcB.start(),
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      rpcA.stop(),
      rpcB.stop(),
    ]);
    //allow goodbye to propagate
    await sleep(200);
    await Promise.all([
      netA.stop(),
      netB.stop(),
    ]);
  });

  it("hello handshake on peer connect", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    expect(netA.hasPeer(netB.peerInfo)).to.equal(true);
    expect(netB.hasPeer(netA.peerInfo)).to.equal(true);
    await new Promise((resolve) => {
      netB.reqResp.once("request", resolve);
    });
    await sleep(200);
    expect(repsA.get(netB.peerInfo.id.toB58String()).latestStatus).to.not.equal(null);
    expect(repsB.get(netA.peerInfo.id.toB58String()).latestStatus).to.not.equal(null);
  });

  it("goodbye on rpc stop", async function () {
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

  it("beacon block by root", async function () {
    const request: BeaconBlocksByRootRequest = [Buffer.alloc(32)];
    const response = await netA.reqResp.beaconBlocksByRoot(netB.peerInfo, request);
    expect(response.length).to.equal(1);
    const block = response[0];
    expect(block.message.slot).to.equal(BLOCK_SLOT);
  });

  it("beacon blocks by range", async () => {
    const request: BeaconBlocksByRangeRequest = {
      startSlot: BLOCK_SLOT,
      count: 2,
      step: 1,
    };

    const response = await netA.reqResp.beaconBlocksByRange(netB.peerInfo, request);
    expect(response.length).to.equal(2);
    const block = response[0];
    expect(block.message.slot).to.equal(BLOCK_SLOT);
    const block2 = response[1];
    expect(block2.message.slot).to.equal(BLOCK_SLOT + 1);
  });
});
