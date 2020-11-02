import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {BeaconBlocksByRangeRequest, BeaconBlocksByRootRequest, RequestBody} from "@chainsafe/lodestar-types";
import {LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import pipe from "it-pipe";
import Libp2p from "libp2p";
import PeerId from "peer-id";
import sinon from "sinon";
import {encode} from "varint";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../../src/constants";
import {BeaconMetrics} from "../../../src/metrics";
import {createRpcProtocol, Libp2pNetwork} from "../../../src/network";
import {decodeP2pErrorMessage} from "../../../src/network/encoders/response";
import {IGossipMessageValidator} from "../../../src/network/gossip/interface";
import {INetworkOptions} from "../../../src/network/options";
import {ReqRespRequest} from "../../../src/network/reqresp";
import {BeaconReqRespHandler, IReqRespHandler} from "../../../src/sync/reqResp";
import {generateEmptySignedBlock} from "../../utils/block";
import {getBlockSummary} from "../../utils/headBlockInfo";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../utils/network";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";

const multiaddr = "/ip4/127.0.0.1/tcp/0";
const opts: INetworkOptions = {
  maxPeers: 1,
  minPeers: 1,
  bootMultiaddrs: [],
  rpcTimeout: 5000,
  connectTimeout: 5000,
  disconnectTimeout: 5000,
  localMultiaddrs: [],
};

const block = generateEmptySignedBlock();
const BLOCK_SLOT = 2020;
block.message.slot = BLOCK_SLOT;
const block2 = generateEmptySignedBlock();
block2.message.slot = BLOCK_SLOT + 1;

describe("[sync] rpc", function () {
  this.timeout(20000);
  const sandbox = sinon.createSandbox();
  const logger = new WinstonLogger({level: LogLevel.debug});
  logger.silent = false;
  const metrics = new BeaconMetrics({enabled: false, timeout: 5000, pushGateway: false}, {logger});

  let rpcA: IReqRespHandler, netA: Libp2pNetwork;
  let rpcB: IReqRespHandler, netB: Libp2pNetwork;
  let libP2pA: Libp2p;
  const validator: IGossipMessageValidator = ({} as unknown) as IGossipMessageValidator;
  let chain: MockBeaconChain;

  beforeEach(async () => {
    const state = generateState();
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: BigInt(0),
      state,
      config,
    });
    chain.getCanonicalBlockAtSlot = sinon.stub().resolves(block);
    const forkChoiceStub = sinon.createStubInstance(ForkChoice);
    chain.forkChoice = forkChoiceStub;
    forkChoiceStub.getHead.returns(
      getBlockSummary({
        finalizedEpoch: computeEpochAtSlot(config, block.message.slot),
      })
    );
    forkChoiceStub.getFinalizedCheckpoint.returns({
      epoch: computeEpochAtSlot(config, block.message.slot),
      root: config.types.BeaconBlock.hashTreeRoot(block.message),
    });
    libP2pA = ((await createNode(multiaddr)) as unknown) as Libp2p;
    netA = new Libp2pNetwork(opts, {config, libp2p: libP2pA, logger, metrics, validator, chain});
    netB = new Libp2pNetwork(opts, {
      config,
      libp2p: ((await createNode(multiaddr)) as unknown) as Libp2p,
      logger,
      metrics,
      validator,
      chain,
    });
    await Promise.all([netA.start(), netB.start()]);

    const db = new StubbedBeaconDb(sandbox, config);
    db.stateCache.get.resolves(state as any);
    db.block.get.resolves(block);
    db.blockArchive.get.resolves(block);
    db.blockArchive.valuesStream.returns(
      (async function* () {
        yield block;
        yield block2;
      })()
    );
    rpcA = new BeaconReqRespHandler({
      config,
      db,
      chain,
      network: netA,
      logger,
    });

    rpcB = new BeaconReqRespHandler({
      config,
      db,
      chain,
      network: netB,
      logger: logger,
    });
    await Promise.all([rpcA.start(), rpcB.start()]);
  });

  afterEach(async () => {
    await chain.stop();
    await Promise.all([rpcA.stop(), rpcB.stop()]);
    console.error("stopped rpc");
    await Promise.all([netA.stop(), netB.stop()]);
  });

  it("hello handshake on peer connect with correct encoding", async function () {
    // A sends status request to B with ssz encoding
    netA.peerMetadata.setEncoding(netB.peerId, ReqRespEncoding.SSZ);
    expect(netB.peerMetadata.getStatus(netA.peerId)).to.be.equal(null);
    const connected = Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;
    expect(netA.hasPeer(netB.peerId)).to.equal(true);
    expect(netB.hasPeer(netA.peerId)).to.equal(true);
    await new Promise((resolve) => {
      netB.reqResp.once("request", resolve);
    });
    await new Promise((resolve, reject) => {
      // if there is goodbye request from B
      netA.reqResp.once("request", (request: ReqRespRequest<RequestBody>, peer: PeerId) => {
        if (peer.toB58String() === netB.peerId.toB58String() && request.method === Method.Goodbye) {
          reject();
        }
      });
      setTimeout(resolve, 2000);
    });
    expect(netA.peerMetadata.getStatus(netB.peerId)).to.not.equal(null);
    expect(netB.peerMetadata.getStatus(netA.peerId)).to.not.equal(null);
    // B should store A with ssz as preferred encoding
    expect(netA.peerMetadata.getEncoding(netB.peerId)).to.be.equal(ReqRespEncoding.SSZ);
    expect(netB.peerMetadata.getEncoding(netA.peerId)).to.be.equal(ReqRespEncoding.SSZ);
  });

  it("goodbye on rpc stop", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.once("peer:connect", resolve)),
      new Promise((resolve) => netB.once("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;
    await new Promise((resolve) => {
      netA.reqResp.once("request", resolve);
      netB.reqResp.once("request", resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const goodbyeEvent = new Promise((resolve) => netB.reqResp.once("request", (req) => resolve(req.method)));
    const [goodbye] = await Promise.all([goodbyeEvent, rpcA.stop()]);
    expect(goodbye).to.equal(Method.Goodbye);
  });

  it("beacon block by root", async function () {
    const request = [Buffer.alloc(32)] as BeaconBlocksByRootRequest;
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    const response = await netA.reqResp.beaconBlocksByRoot(netB.peerId, request);
    if (!response) throw Error("beaconBlocksByRoot returned null");
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

    await netA.connect(netB.peerId, netB.localMultiaddrs);
    const response = await netA.reqResp.beaconBlocksByRange(netB.peerId, request);
    if (!response) throw Error("beaconBlocksByRoot returned null");
    expect(response.length).to.equal(2);
    const block = response[0];
    expect(block.message.slot).to.equal(BLOCK_SLOT);
    const block2 = response[1];
    expect(block2.message.slot).to.equal(BLOCK_SLOT + 1);
  });

  it("should return invalid request status code", async () => {
    const protocol = createRpcProtocol(Method.Status, ReqRespEncoding.SSZ_SNAPPY);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    const {stream} = (await libP2pA.dialProtocol(netB.peerId, protocol)) as {stream: Stream};
    await pipe([Buffer.from(encode(99999999999999999999999))], stream, async (source: AsyncIterable<Buffer>) => {
      let i = 0;
      // 1 chunk of status and 1 chunk of error
      for await (const val of source) {
        if (i === 0) {
          const status = val.slice()[0];
          expect(status).to.be.equal(RpcResponseStatus.ERR_INVALID_REQ);
        } else {
          // i should be 1
          const errBuf = val.slice();
          // message from the server side
          expect(decodeP2pErrorMessage(config, errBuf)).to.be.equal("Invalid request");
        }
        i++;
      }
    });
  });
});
