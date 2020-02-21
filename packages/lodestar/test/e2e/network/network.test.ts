import {expect} from "chai";
import {afterEach, beforeEach, describe, it} from "mocha";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {Libp2pNetwork} from "../../../src/network";
import {createNode} from "../../unit/network/util";
import {generateEmptyAttestation} from "../../utils/attestation";
import {generateEmptySignedBlock} from "../../utils/block";
import {ILogger, WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {INetworkOptions} from "../../../src/network/options";
import {BeaconMetrics} from "../../../src/metrics";
import {sleep} from "../../../src/util/sleep";
// @ts-ignore
import Libp2p from "libp2p";
import {GossipEvent} from "../../../src/network/gossip/constants";
import sinon from "sinon";
import { GossipMessageValidator } from "../../../src/network/gossip/validator";
import { SignedBeaconBlock, Attestation } from "@chainsafe/eth2.0-types";

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

  beforeEach(async () => {
    netA = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator});
    netB = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr) as unknown as Libp2p, logger, metrics, validator});
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
    let count = 0;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.on(GossipEvent.BLOCK, () => {
        count ++;
      });
      setTimeout(() => resolve(count), 1000);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    validator.isValidIncomingBlock.resolves(true);
    const block = generateEmptySignedBlock();
    block.message.slot = 2020;
    for (let i = 0; i < 5; i++) {
      netB.gossip.publishBlock(block);
    }
    expect(await received).to.be.equal(1);
  });
  it("should receive blocks on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.on(GossipEvent.BLOCK, (signedBlock: SignedBeaconBlock): void => {
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
  it("should receive attestations on subscription", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.on(GossipEvent.ATTESTATION, (attestation: Attestation): void => {resolve(attestation);});
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    validator.isValidIncomingUnaggregatedAttestation.resolves(true);
    const attestation = generateEmptyAttestation();
    attestation.data.slot = 2020;
    netB.gossip.publishCommiteeAttestation(attestation);
    const receivedAttestation = await received;
    expect(receivedAttestation).to.be.deep.equal(attestation);
  });
  it("should receive shard attestations on subscription", async function () {
    const committeeIndex = 10;
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      // @ts-ignore
      netA.gossip.on(GossipEvent.ATTESTATION, resolve);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    const attestation = generateEmptyAttestation();
    attestation.data.index = committeeIndex;
    validator.isValidIncomingUnaggregatedAttestation.resolves(true);
    netB.gossip.publishCommiteeAttestation(attestation);
    await received;
  });
});
