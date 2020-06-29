import {expect} from "chai";
import {afterEach, beforeEach, describe, it} from "mocha";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {createPeerId, Libp2pNetwork} from "../../../src/network";
import {generateEmptyAttestation, generateEmptySignedAggregateAndProof} from "../../utils/attestation";
import {generateEmptySignedBlock} from "../../utils/block";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {INetworkOptions} from "../../../src/network/options";
import {BeaconMetrics} from "../../../src/metrics";
import {sleep} from "../../../src/util/sleep";
import Libp2p from "libp2p";
import sinon, {SinonStubbedInstance} from "sinon";
import {GossipMessageValidator} from "../../../src/network/gossip/validator";
import {Attestation, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {generateState} from "../../utils/state";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {IBeaconChain} from "../../../src/chain";
import PeerId from "peer-id";
import {Discv5Discovery, ENR} from "@chainsafe/discv5";
import {createNode} from "../../utils/network";
import {ReputationStore} from "../../../src/sync/IReputation";
import {getAttestationSubnetEvent} from "../../../src/network/gossip/utils";

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
  let peerIdB: PeerId;
  let libP2pA: LibP2p;
  let libP2pB: LibP2p;
  const logger: ILogger = new WinstonLogger();
  logger.silent = true;
  const metrics = new BeaconMetrics({enabled: true, timeout: 5000, pushGateway: false}, {logger});
  const validator = {} as GossipMessageValidator & SinonStubbedInstance<GossipMessageValidator>;
  validator.isValidIncomingBlock = sinon.stub();
  validator.isValidIncomingAggregateAndProof = sinon.stub();
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
    peerIdB = await createPeerId();
    [libP2pA, libP2pB] = await Promise.all([
      createNode(multiaddr) as unknown as Libp2p,
      createNode(multiaddr, peerIdB) as unknown as Libp2p
    ]);
    netA = new Libp2pNetwork(opts, new ReputationStore(), {config, libp2p: libP2pA, logger, metrics, validator, chain});
    netB = new Libp2pNetwork(opts, new ReputationStore(), {config, libp2p: libP2pB, logger, metrics, validator, chain});
    await Promise.all([
      netA.start(),
      netB.start(),
    ]);
    // @ts-ignore
    netA.libp2p.peerStore.peers.clear();
    // @ts-ignore
    netB.libp2p.peerStore.peers.clear();
  });
  afterEach(async () => {
    await Promise.all([
      netA.stop(),
      netB.stop(),
    ]);
    sinon.restore();
  });
  it("should create a peer on connect", async function () {
    let connectACount = 0;
    let connectBCount = 0;
    await Promise.all([
      new Promise((resolve) => netA.on("peer:connect", () => {
        connectACount++;
        resolve();
      })),
      new Promise((resolve) => netB.on("peer:connect", () => {
        connectBCount++;
        resolve();
      })),
      netA.connect(netB.peerInfo)
    ]);
    expect(connectACount).to.be.equal(1);
    expect(connectBCount).to.be.equal(1);
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
    await sleep(200);
    expect(netA.getPeers().length).to.equal(0);
    expect(netB.getPeers().length).to.equal(0);
  });
  it("should not receive duplicate block", async function() {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    const spy = sinon.spy();
    const forkDigest = chain.currentForkDigest;
    const received = new Promise((resolve) => {
      netA.gossip.subscribeToBlock(forkDigest, () => {
        spy();
        resolve();
      });
      setTimeout(resolve, 2000);
    });
    await netA.connect(netB.peerInfo);
    await connected;
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

    netB.reqResp.once("request", (peerId, method, requestId) => {
      netB.reqResp.sendResponse(requestId, null, netB.metadata.seqNumber);
    });
    const seqNumber = await netA.reqResp.ping(netB.peerInfo, netA.metadata.seqNumber);
    expect(seqNumber.toString()).to.equal(netB.metadata.seqNumber.toString());
  });
  it("should send/receive metadata messages", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;

    netB.reqResp.once("request", (peerId, method, requestId) => {
      netB.reqResp.sendResponse(requestId, null, netB.metadata);
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
      netA.gossip.subscribeToAggregateAndProof(forkDigest, resolve);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    validator.isValidIncomingAggregateAndProof.resolves(true);
    await netB.gossip.publishAggregatedAttestation(generateEmptySignedAggregateAndProof());
    await received;
  });
  it("should receive committee attestations on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const forkDigest = chain.currentForkDigest;
    let callback: (attestation:  {attestation: Attestation; subnet: number}) => void;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.subscribeToAttestationSubnet(forkDigest, 0, resolve);
      callback = resolve;
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    const attestation = generateEmptyAttestation();
    attestation.data.index = 0;
    validator.isValidIncomingCommitteeAttestation.resolves(true);
    await netB.gossip.publishCommiteeAttestation(attestation);
    await received;
    expect(netA.gossip.listenerCount(getAttestationSubnetEvent(0))).to.be.equal(1);
    netA.gossip.unsubscribeFromAttestationSubnet(forkDigest, "0", callback);
    expect(netA.gossip.listenerCount(getAttestationSubnetEvent(0))).to.be.equal(0);
  });
  it("should connect to new peer by subnet", async function() {
    const subnet = 10;
    netB.metadata.attnets[subnet] = true;
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    netB.reqResp.once("request", (peerId, method, requestId) => {
      netB.reqResp.sendResponse(requestId, null, netB.metadata);
    });

    const enrB = ENR.createFromPeerId(peerIdB);
    enrB.set("attnets", Buffer.from(config.types.AttestationSubnets.serialize(netB.metadata.attnets)));
    enrB.multiaddrUDP = (libP2pB._discovery.get("discv5") as Discv5Discovery).discv5.bindAddress;
    enrB.multiaddrTCP = libP2pB.peerInfo.multiaddrs.toArray()[0];
    // let discv5 of A know enr of B
    const discovery: Discv5Discovery = libP2pA._discovery.get("discv5") as Discv5Discovery;
    discovery.discv5.addEnr(enrB);
    await netA.searchSubnetPeers(subnet.toString());
    await connected;
    expect(netA.getPeers().length).to.be.equal(1);
  });
});
