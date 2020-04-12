import {expect} from "chai";
import {afterEach, beforeEach, describe, it} from "mocha";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Libp2pNetwork} from "../../../src/network";
import {createNode} from "../../unit/network/util";
import {generateEmptyAttestation, generateEmptySignedAggregateAndProof} from "../../utils/attestation";
import {generateEmptySignedBlock} from "../../utils/block";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {INetworkOptions} from "../../../src/network/options";
import {BeaconMetrics} from "../../../src/metrics";
import {sleep} from "../../../src/util/sleep";
import Libp2p from "libp2p";
import sinon from "sinon";
import {GossipMessageValidator} from "../../../src/network/gossip/validator";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {generateState} from "../../utils/state";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {IBeaconChain} from "../../../src/chain";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

const opts: INetworkOptions = {
  maxPeers: 1,
  bootnodes: [],
  rpcTimeout: 5000,
  connectTimeout: 5000,
  disconnectTimeout: 5000,
  multiaddrs: [],
};

describe("[network] network", function () {
  this.timeout(5000);
  let netA: Libp2pNetwork, netB: Libp2pNetwork;
  const logger: ILogger = new WinstonLogger();
  logger.silent = true;
  const metrics = new BeaconMetrics({enabled: true, timeout: 5000, pushGateway: false}, {logger});
  const validator = sinon.createStubInstance(GossipMessageValidator);
  validator.isValidIncomingBlock = sinon.stub();
  validator.isValidIncomingAggregateAndProof = sinon.stub();
  validator.isValidIncomingUnaggregatedAttestation = sinon.stub();
  validator.isValidIncomingCommitteeAttestation = sinon.stub();
  let chain: IBeaconChain;

  beforeEach(async () => {
    const state = generateState();
    const block = generateEmptySignedBlock();
    state.finalizedCheckpoint = {
      epoch: 0,
      root: config.types.BeaconBlock.hashTreeRoot(block.message),
    };
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: 0n,
      state,
      config
    });
    netA = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator, chain});
    netB = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator, chain});
    await Promise.all([
      netA.start(),
      netB.start(),
    ]);
  });
  afterEach(async () => {
    await Promise.all([
      netA.stop(),
      netB.stop(),
    ]);
    sinon.restore();
  });
  it("should create a peer on connect", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    expect(netA.getPeers().length).to.equal(1);
    expect(netB.getPeers().length).to.equal(1);
  });
  it("should delete a peer on disconnect", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const disconnection = Promise.all([
      new Promise((resolve) => netA.on("peer:disconnect", resolve)),
      new Promise((resolve) => netB.on("peer:disconnect", resolve)),
    ]);
    await sleep(100);

    await netA.disconnect(netB.peerInfo);
    await disconnection;
    expect(netA.getPeers().length).to.equal(0);
    expect(netB.getPeers().length).to.equal(0);
  });
  it("should not receive duplicate block", async function() {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const spy = sinon.spy();
    const forkDigest = chain.currentForkDigest;
    const received = new Promise((resolve) => {
      netA.gossip.subscribeToBlock(forkDigest, spy);
      setTimeout(resolve, 1000);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    validator.isValidIncomingBlock.resolves(true);
    const block = generateEmptySignedBlock();
    block.message.slot = 2020;
    for (let i = 0; i < 5; i++) {
      await netB.gossip.publishBlock(block);
    }
    await received;
    expect(spy.callCount).to.be.equal(1);
  });
  it("should send/receive ping messages", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;

    netB.reqResp.once("request", (peerId, method, requestId, request) => {
      netB.reqResp.sendResponse(requestId, null, [netB.metadata.seqNumber]);
    });
    const seqNumber = await netA.reqResp.ping(netB.peerInfo, netA.metadata.seqNumber);
    expect(seqNumber).to.equal(netB.metadata.seqNumber);
  });
  it("should send/receive metadata messages", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;

    netB.reqResp.once("request", (peerId, method, requestId, request) => {
      netB.reqResp.sendResponse(requestId, null, [netB.metadata]);
    });
    const metadata = await netA.reqResp.metadata(netB.peerInfo);
    expect(metadata).to.deep.equal(netB.metadata.metadata);
  });
  it("should receive blocks on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const forkDigest = chain.currentForkDigest;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.subscribeToBlock(forkDigest, (signedBlock: SignedBeaconBlock): void => {
        resolve(signedBlock);
      });
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    validator.isValidIncomingBlock.resolves(true);
    const block = generateEmptySignedBlock();
    block.message.slot = 2020;
    netB.gossip.publishBlock(block);
    const receivedBlock = await received;
    expect(receivedBlock).to.be.deep.equal(block);
  });
  it("should receive aggregate on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const forkDigest = chain.currentForkDigest;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.subscribeToAttestation(forkDigest, resolve);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    validator.isValidIncomingUnaggregatedAttestation.resolves(true);
    await netB.gossip.publishAggregatedAttestation(generateEmptySignedAggregateAndProof());
    await received;
  });
  it("should receive shard attestations on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const forkDigest = chain.currentForkDigest;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.subscribeToAttestationSubnet(forkDigest, 0, resolve);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    const attestation = generateEmptyAttestation();
    attestation.data.index = 0;
    validator.isValidIncomingCommitteeAttestation.resolves(true);
    await netB.gossip.publishCommiteeAttestation(attestation);
    await received;
  });
});
