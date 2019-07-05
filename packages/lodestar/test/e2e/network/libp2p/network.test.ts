import {expect} from "chai";

import {Libp2pNetwork, INetworkOptions} from "../../../../src/network";
import {BLOCK_TOPIC, ATTESTATION_TOPIC} from "@chainsafe/eth2-types";
import {getEmptyBlock} from "../../../../src/chain/genesis";
import {createNode} from "../../../unit/network/libp2p/util";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {shardAttestationTopic} from "../../../../src/network/util";
import {ILogger, WinstonLogger} from "../../../../src/logger";

const multiaddr = "/ip4/127.0.0.1/tcp/0";
const opts: INetworkOptions = {
  maxPeers: 1,
  bootnodes: [],
  rpcTimeout: 5000,
  connectTimeout: 5000,
  disconnectTimeout: 5000,
  multiaddrs: [],
};

describe("[network] network", () => {

  let netA: Libp2pNetwork, netB: Libp2pNetwork;
  const logger: ILogger = new WinstonLogger();

  beforeEach(async () => {
    netA = new Libp2pNetwork(opts, {libp2p: createNode(multiaddr), logger: logger});
    netB = new Libp2pNetwork(opts, {libp2p: createNode(multiaddr), logger: logger});
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
  });
  it("should create a peer on connect", async function () {
    await netA.connect(netB.peerInfo);
    await Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    expect(netA.getPeers().length).to.equal(1);
    expect(netB.getPeers().length).to.equal(1);
  });
  it("should delete a peer on disconnect", async function () {
    await netA.connect(netB.peerInfo);
    await Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    const disconnection = Promise.all([
      new Promise((resolve) => netA.on("peer:disconnect", resolve)),
      new Promise((resolve) => netB.on("peer:disconnect", resolve)),
    ]);
    await netA.disconnect(netB.peerInfo);
    await disconnection;
    expect(netA.getPeers().length).to.equal(0);
    expect(netB.getPeers().length).to.equal(0);
  });
  it("should receive blocks on subscription", async function () {
    netA.subscribeToBlocks();
    await netA.connect(netB.peerInfo);
    await Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.on(BLOCK_TOPIC, resolve);
    });
    await new Promise((resolve) => netB.once("gossipsub:heartbeat", resolve));
    netB.publishBlock(getEmptyBlock());
    await received;
  });
  it("should receive attestations on subscription", async function () {
    netA.subscribeToAttestations();
    await netA.connect(netB.peerInfo);
    await Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.on(ATTESTATION_TOPIC, resolve);
    });
    await new Promise((resolve) => netB.once("gossipsub:heartbeat", resolve));
    netB.publishAttestation(generateEmptyAttestation());
    await received;
  });
  it("should receive shard attestations on subscription", async function () {
    const shard = 10;
    netA.subscribeToShardAttestations(shard);
    const topic = shardAttestationTopic(shard);
    await netA.connect(netB.peerInfo);
    await Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.on(topic, resolve);
    });
    await new Promise((resolve) => netB.once("gossipsub:heartbeat", resolve));
    const attestation = generateEmptyAttestation();
    attestation.data.crosslink.shard = shard;
    netB.publishShardAttestation(attestation);
    await received;
  });
});
