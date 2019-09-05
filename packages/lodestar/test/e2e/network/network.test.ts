import {expect} from "chai";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {Libp2pNetwork} from "../../../src/network";
import {BLOCK_TOPIC, ATTESTATION_TOPIC} from "../../../src/constants";
import {getEmptyBlock} from "../../../src/chain/genesis/genesis";
import {createNode} from "../../unit/network/util";
import {generateEmptyAttestation} from "../../utils/attestation";
import {shardAttestationTopic} from "../../../src/network/util";
import {ILogger, WinstonLogger} from "../../../src/logger";
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

describe("[network] network", () => {

  let netA: Libp2pNetwork, netB: Libp2pNetwork;
  const logger: ILogger = new WinstonLogger();
  const metrics = new BeaconMetrics({enabled: true, timeout: 5000, pushGateway: false});

  beforeEach(async () => {
    netA = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr), logger, metrics});
    netB = new Libp2pNetwork(opts, {config, libp2p: createNode(multiaddr), logger, metrics});
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
    await netA.disconnect(netB.peerInfo);
    await disconnection;
    expect(netA.getPeers().length).to.equal(0);
    expect(netB.getPeers().length).to.equal(0);
  });
  it("should receive blocks on subscription", async function () {
    netA.gossip.subscribeToBlocks();
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.on(BLOCK_TOPIC, resolve);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    netB.gossip.publishBlock(getEmptyBlock());
    await received;
  });
  it("should receive attestations on subscription", async function () {
    netA.gossip.subscribeToAttestations();
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      netA.gossip.on(ATTESTATION_TOPIC, resolve);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    netB.gossip.publishAttestation(generateEmptyAttestation());
    await received;
  });
  it("should receive shard attestations on subscription", async function () {
    const shard = 10;
    netA.gossip.subscribeToShardAttestations(shard);
    const topic = shardAttestationTopic(shard);
    const connected = Promise.all([
      new Promise((resolve) => netA.on("peer:connect", resolve)),
      new Promise((resolve) => netB.on("peer:connect", resolve)),
    ]);
    await netA.connect(netB.peerInfo);
    await connected;
    const received = new Promise((resolve, reject) => {
      setTimeout(reject, 4000);
      // @ts-ignore
      netA.gossip.on(topic, resolve);
    });
    await new Promise((resolve) => netB.gossip.once("gossipsub:heartbeat", resolve));
    const attestation = generateEmptyAttestation();
    attestation.data.crosslink.shard = shard;
    netB.gossip.publishShardAttestation(attestation);
    await received;
  });
});
