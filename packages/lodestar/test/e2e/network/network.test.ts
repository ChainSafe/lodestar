import {Discv5Discovery, ENR} from "@chainsafe/discv5";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {Attestation, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ILogger, sleep, WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import Libp2p from "libp2p";
import PeerId from "peer-id";
import sinon, {SinonStubbedInstance} from "sinon";
import {IBeaconChain} from "../../../src/chain";
import {Method} from "../../../src/constants";
import {BeaconMetrics} from "../../../src/metrics";
import {createPeerId, Libp2pNetwork} from "../../../src/network";
import {ExtendedValidatorResult} from "../../../src/network/gossip/constants";
import {getAttestationSubnetEvent} from "../../../src/network/gossip/utils";
import {GossipMessageValidator} from "../../../src/network/gossip/validator";
import {INetworkOptions} from "../../../src/network/options";
import {generateEmptyAttestation, generateEmptySignedAggregateAndProof} from "../../utils/attestation";
import {generateEmptySignedBlock} from "../../utils/block";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../utils/network";
import {generateState} from "../../utils/state";

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
    const block = generateEmptySignedBlock();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: config.types.BeaconBlock.hashTreeRoot(block.message),
      },
    });
    // state.finalizedCheckpoint = {
    //   epoch: 0,
    //   root: config.types.BeaconBlock.hashTreeRoot(block.message),
    // };
    chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: BigInt(0),
      state,
      config,
    });
    peerIdB = await createPeerId();
    [libP2pA, libP2pB] = await Promise.all([
      (createNode(multiaddr) as unknown) as Libp2p,
      (createNode(multiaddr, peerIdB) as unknown) as Libp2p,
    ]);
    netA = new Libp2pNetwork(opts, {config, libp2p: libP2pA, logger, metrics, validator, chain});
    netB = new Libp2pNetwork(opts, {config, libp2p: libP2pB, logger, metrics, validator, chain});
    await Promise.all([netA.start(), netB.start()]);
  });
  afterEach(async () => {
    await chain.close();
    await Promise.all([netA.stop(), netB.stop()]);
    sinon.restore();
  });
  it("should create a peer on connect", async function () {
    let connectACount = 0;
    let connectBCount = 0;
    await Promise.all([
      new Promise((resolve) =>
        netA.on("peer:connect", () => {
          connectACount++;
          resolve();
        })
      ),
      new Promise((resolve) =>
        netB.on("peer:connect", () => {
          connectBCount++;
          resolve();
        })
      ),
      netA.connect(netB.peerId, netB.localMultiaddrs),
    ]);
    expect(connectACount).to.be.equal(1);
    expect(connectBCount).to.be.equal(1);
    expect(netA.getPeers({connected: true}).length).to.equal(1);
    expect(netB.getPeers({connected: true}).length).to.equal(1);
  });
  it("should delete a peer on disconnect", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;
    const disconnection = Promise.all([
      new Promise((resolve) => netA.on("peer:disconnect", resolve)),
      new Promise((resolve) => netB.on("peer:disconnect", resolve)),
    ]);
    await sleep(100);

    await netA.disconnect(netB.peerId);
    await disconnection;
    await sleep(200);
    expect(netA.getPeers({connected: true}).length).to.equal(0);
    expect(netB.getPeers({connected: true}).length).to.equal(0);
  });
  it("should not receive duplicate block", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    const spy = sinon.spy();
    const forkDigest = await chain.getForkDigest();
    const received = new Promise((resolve) => {
      netA.gossip.subscribeToBlock(forkDigest, () => {
        spy();
        resolve();
      });
      setTimeout(resolve, 2000);
    });
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;
    // wait for peers to be connected in libp2p-interfaces
    await new Promise((resolve) => setTimeout(resolve, 200));
    validator.isValidIncomingBlock.resolves(ExtendedValidatorResult.accept);
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
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;

    netB.reqResp.registerHandler(async function* (method) {
      if (method === Method.Ping) {
        yield netB.metadata.seqNumber;
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    const seqNumber = await netA.reqResp.ping(netB.peerId, netA.metadata.seqNumber);
    expect(seqNumber!.toString()).to.equal(netB.metadata.seqNumber.toString());
  });
  it("should send/receive metadata messages", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;

    netB.reqResp.registerHandler(async function* (method) {
      if (method === Method.Metadata) {
        yield netB.metadata;
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    const metadata = await netA.reqResp.metadata(netB.peerId);
    expect(metadata).to.deep.equal(netB.metadata.metadata);
  });
  it("should receive blocks on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;
    const forkDigest = await chain.getForkDigest();
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.subscribeToBlock(forkDigest, (signedBlock: SignedBeaconBlock): void => {
        resolve(signedBlock);
      });
    });
    // wait for peers to be connected in libp2p-interfaces
    await new Promise((resolve) => setTimeout(resolve, 200));
    validator.isValidIncomingBlock.resolves(ExtendedValidatorResult.accept);
    const block = generateEmptySignedBlock();
    block.message.slot = 2020;
    void netB.gossip.publishBlock(block).catch((e) => console.error(e));
    const receivedBlock = await received;
    expect(config.types.SignedBeaconBlock.equals(receivedBlock as SignedBeaconBlock, block)).to.be.true;
  });
  it("should receive aggregate on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;
    const forkDigest = await chain.getForkDigest();
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.subscribeToAggregateAndProof(forkDigest, resolve);
    });
    // wait for peers to be connected in libp2p-interfaces
    await new Promise((resolve) => setTimeout(resolve, 200));
    validator.isValidIncomingAggregateAndProof.resolves(ExtendedValidatorResult.accept);
    await netB.gossip.publishAggregatedAttestation(generateEmptySignedAggregateAndProof());
    await received;
  });
  it("should receive committee attestations on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;
    const forkDigest = await chain.getForkDigest();
    let callback: (attestation: {attestation: Attestation; subnet: number}) => void;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.subscribeToAttestationSubnet(forkDigest, 0, resolve);
      callback = resolve;
    });
    // wait for peers to be connected in libp2p-interfaces
    await new Promise((resolve) => setTimeout(resolve, 200));
    const attestation = generateEmptyAttestation();
    attestation.data.index = 0;
    validator.isValidIncomingCommitteeAttestation.resolves(ExtendedValidatorResult.accept);
    await netB.gossip.publishCommiteeAttestation(attestation);
    await received;
    expect(netA.gossip.listenerCount(getAttestationSubnetEvent(0))).to.be.equal(1);
    netA.gossip.unsubscribeFromAttestationSubnet(forkDigest, "0", callback!);
    expect(netA.gossip.listenerCount(getAttestationSubnetEvent(0))).to.be.equal(0);
  });
  it("should connect to new peer by subnet", async function () {
    const subnet = 10;
    netB.metadata.attnets[subnet] = true;
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    const enrB = ENR.createFromPeerId(peerIdB);
    enrB.set("attnets", Buffer.from(config.types.AttestationSubnets.serialize(netB.metadata.attnets)));
    enrB.setLocationMultiaddr((libP2pB._discovery.get("discv5") as Discv5Discovery).discv5.bindAddress);
    enrB.setLocationMultiaddr(libP2pB.multiaddrs[0]);
    // let discv5 of A know enr of B
    const discovery: Discv5Discovery = libP2pA._discovery.get("discv5") as Discv5Discovery;
    discovery.discv5.addEnr(enrB);
    await netA.searchSubnetPeers([subnet.toString()]);
    await connected;
    expect(netA.getPeers({connected: true}).length).to.be.equal(1);
  });
});
