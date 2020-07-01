import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {encode} from "varint";

import {Method, ReqRespEncoding, RpcResponseStatus} from "../../../src/constants";
import {ReputationStore} from "../../../src/sync/IReputation";
import {Libp2pNetwork, createRpcProtocol} from "../../../src/network";
import Libp2p from "libp2p";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {WinstonLogger, LogLevel} from "@chainsafe/lodestar-utils/lib/logger";
import {INetworkOptions} from "../../../src/network/options";
import {BeaconMetrics} from "../../../src/metrics";
import {generateState} from "../../utils/state";
import {IGossipMessageValidator} from "../../../src/network/gossip/interface";
import {generateEmptySignedBlock} from "../../utils/block";
import {BeaconBlocksByRangeRequest, BeaconBlocksByRootRequest} from "@chainsafe/lodestar-types";
import {BeaconReqRespHandler, IReqRespHandler} from "../../../src/sync/reqResp";
import {sleep} from "../../utils/sleep";
import {createNode} from "../../utils/network";
import {StubbedBeaconDb} from "../../utils/stub";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {StatefulDagLMDGHOST} from "../../../src/chain/forkChoice/statefulDag";
import {getBlockSummary} from "../../utils/headBlockInfo";
import pipe from "it-pipe";
import {decodeP2pErrorMessage} from "../../../src/network/encoders/response";

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
  const logger = new WinstonLogger({level: LogLevel.verbose});
  logger.silent = true;
  const metrics = new BeaconMetrics({enabled: false, timeout: 5000, pushGateway: false}, {logger});

  let rpcA: IReqRespHandler, netA: Libp2pNetwork, repsA: ReputationStore;
  let rpcB: IReqRespHandler, netB: Libp2pNetwork, repsB: ReputationStore;
  let libP2pA: Libp2p;
  const validator: IGossipMessageValidator = {} as unknown as IGossipMessageValidator;

  beforeEach(async () => {
    const state = generateState();
    const chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId:BigInt(0),
      state,
      config
    });
    chain.getBlockAtSlot = sinon.stub().resolves(block);
    const forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
    chain.forkChoice = forkChoiceStub;
    forkChoiceStub.head.returns(getBlockSummary({
      finalizedCheckpoint: {
        epoch: computeEpochAtSlot(config, block.message.slot),
        root: config.types.BeaconBlock.hashTreeRoot(block.message),
      }
    }));
    forkChoiceStub.getFinalized.returns({
      epoch: computeEpochAtSlot(config, block.message.slot),
      root: config.types.BeaconBlock.hashTreeRoot(block.message),
    });
    repsA = new ReputationStore();
    repsB = new ReputationStore();
    libP2pA = (await createNode(multiaddr)) as unknown as Libp2p;
    netA = new Libp2pNetwork(
      opts,
      repsA,
      {config, libp2p: libP2pA, logger, metrics, validator, chain}
    );
    netB = new Libp2pNetwork(
      opts,
      repsB,
      {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator, chain}
    );
    await Promise.all([
      netA.start(),
      netB.start(),
    ]);

    const db = new StubbedBeaconDb(sandbox, config);
    db.stateCache.get.resolves(state as any);
    db.block.get.resolves(block);
    db.blockArchive.get.resolves(block);
    db.blockArchive.valuesStream.returns(async function * () {
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

  it("hello handshake on peer connect with correct encoding", async function () {
    // A sends status request to B with ssz encoding
    repsA.get(netB.peerId.toB58String()).encoding = ReqRespEncoding.SSZ;
    expect(repsB.get(netA.peerId.toB58String()).latestStatus).to.be.equal(null);
    const connected = Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.multiaddrs);
    await connected;
    expect(netA.hasPeer(netB.peerId)).to.equal(true);
    expect(netB.hasPeer(netA.peerId)).to.equal(true);
    await new Promise((resolve) => {
      netB.reqResp.once("request", resolve);
    });
    await new Promise((resolve, reject) => {
      // if there is goodbye request from B
      netA.reqResp.once("request", (a, b, c) => reject([a, b, c]));
      setTimeout(resolve, 2000);
    });
    expect(repsA.get(netB.peerId.toB58String()).latestStatus).to.not.equal(null);
    expect(repsB.get(netA.peerId.toB58String()).latestStatus).to.not.equal(null);
    // B should store A with ssz as preferred encoding
    expect(repsA.get(netB.peerId.toB58String()).encoding).to.be.equal(ReqRespEncoding.SSZ);
    expect(repsB.get(netA.peerId.toB58String()).encoding).to.be.equal(ReqRespEncoding.SSZ);
  });

  it("goodbye on rpc stop", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.multiaddrs);
    await connected;
    await new Promise((resolve) => {
      netA.reqResp.once("request", resolve);
      netB.reqResp.once("request", resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const goodbyeEvent = new Promise((resolve) => netB.reqResp.once("request", (_, method) => resolve(method)));
    const [goodbye] = await Promise.all([
      goodbyeEvent,
      rpcA.stop()
    ]);
    expect(goodbye).to.equal(Method.Goodbye);
  });

  it("beacon block by root", async function () {
    const request: BeaconBlocksByRootRequest = [Buffer.alloc(32)];
    await netA.connect(netB.peerId, netB.multiaddrs);
    const response = await netA.reqResp.beaconBlocksByRoot(netB.peerId, request);
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

    await netA.connect(netB.peerId, netB.multiaddrs);
    const response = await netA.reqResp.beaconBlocksByRange(netB.peerId, request);
    expect(response.length).to.equal(2);
    const block = response[0];
    expect(block.message.slot).to.equal(BLOCK_SLOT);
    const block2 = response[1];
    expect(block2.message.slot).to.equal(BLOCK_SLOT + 1);
  });

  it("should return invalid request status code", async () => {
    const protocol = createRpcProtocol(Method.Status, ReqRespEncoding.SSZ_SNAPPY);
    await netA.connect(netB.peerId, netB.multiaddrs);
    const {stream} = await libP2pA.dialProtocol(netB.peerId, protocol) as {stream: Stream};
    await pipe(
      [Buffer.from(encode(99999999999999999999999))],
      stream,
      async (source: AsyncIterable<Buffer>) => {
        let i = 0;
        // 1 chunk of status and 1 chunk of error
        for await (const val of source) {
          if (i === 0) {
            const status = val.slice()[0];
            expect(status).to.be.equal(RpcResponseStatus.ERR_INVALID_REQ);
          } else {
            // i should be 1
            const errBuf = val.slice();
            const err = config.types.P2pErrorMessage.deserialize(errBuf);
            // message from the server side
            expect(decodeP2pErrorMessage(config, err)).to.be.equal("Invalid Request");
          }
          i++;
        }
      }
    );
  });
});
