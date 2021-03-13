import sinon from "sinon";
import {expect} from "chai";

import PeerId from "peer-id";
import {Discv5Discovery, ENR} from "@chainsafe/discv5";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ILogger, sleep, Logger} from "@chainsafe/lodestar-utils";

import {IBeaconChain} from "../../../src/chain";
import {IBeaconDb} from "../../../src/db";
import {BeaconMetrics} from "../../../src/metrics";
import {createPeerId, Network, NetworkEvent} from "../../../src/network";
import {INetworkOptions} from "../../../src/network/options";

import {generateEmptySignedBlock} from "../../utils/block";
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

describe("[network] network", function () {
  this.timeout(5000);
  let netA: Network, netB: Network;
  let peerIdB: PeerId;
  let libP2pA: LibP2p;
  let libP2pB: LibP2p;
  const logger: ILogger = new Logger();
  logger.silent = true;
  const metrics = new BeaconMetrics({enabled: true, timeout: 5000, pushGateway: false}, {logger});
  let db: StubbedBeaconDb & IBeaconDb;
  let chain: IBeaconChain;

  beforeEach(async () => {
    const block = generateEmptySignedBlock();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: config.types.phase0.BeaconBlock.hashTreeRoot(block.message),
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
    db = new StubbedBeaconDb(sinon, config) as StubbedBeaconDb & IBeaconDb;
    peerIdB = await createPeerId();
    [libP2pA, libP2pB] = await Promise.all([createNode(multiaddr), createNode(multiaddr, peerIdB)]);
    netA = new Network(opts, {config, libp2p: libP2pA, logger, metrics, db, chain});
    netB = new Network(opts, {config, libp2p: libP2pB, logger, metrics, db, chain});
    await Promise.all([netA.start(), netB.start()]);
  });

  afterEach(async () => {
    chain.close();
    await Promise.all([netA.stop(), netB.stop()]);
    sinon.restore();
  });

  it("should create a peer on connect", async function () {
    let connectACount = 0;
    let connectBCount = 0;
    await Promise.all([
      new Promise<void>((resolve) =>
        netA.on(NetworkEvent.peerConnect, () => {
          connectACount++;
          resolve();
        })
      ),
      new Promise<void>((resolve) =>
        netB.on(NetworkEvent.peerConnect, () => {
          connectBCount++;
          resolve();
        })
      ),
      netA.connect(netB.peerId, netB.localMultiaddrs),
    ]);
    expect(connectACount).to.be.equal(1);
    expect(connectBCount).to.be.equal(1);
    expect(netA.getPeers().length).to.equal(1);
    expect(netB.getPeers().length).to.equal(1);
  });

  it("should delete a peer on disconnect", async function () {
    const connected = Promise.all([
      new Promise((resolve) => netA.on(NetworkEvent.peerConnect, resolve)),
      new Promise((resolve) => netB.on(NetworkEvent.peerConnect, resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;
    const disconnection = Promise.all([
      new Promise((resolve) => netA.on(NetworkEvent.peerDisconnect, resolve)),
      new Promise((resolve) => netB.on(NetworkEvent.peerDisconnect, resolve)),
    ]);
    await sleep(100);

    await netA.disconnect(netB.peerId);
    await disconnection;
    await sleep(200);
    expect(netA.getPeers().length).to.equal(0);
    expect(netB.getPeers().length).to.equal(0);
  });

  it("should connect to new peer by subnet", async function () {
    const subnet = 10;
    netB.metadata.attnets[subnet] = true;
    const connected = Promise.all([
      new Promise((resolve) => netA.on(NetworkEvent.peerConnect, resolve)),
      new Promise((resolve) => netB.on(NetworkEvent.peerConnect, resolve)),
    ]);
    const enrB = ENR.createFromPeerId(peerIdB);
    enrB.set("attnets", Buffer.from(config.types.phase0.AttestationSubnets.serialize(netB.metadata.attnets)));
    enrB.setLocationMultiaddr((libP2pB._discovery.get("discv5") as Discv5Discovery).discv5.bindAddress);
    enrB.setLocationMultiaddr(libP2pB.multiaddrs[0]);
    // let discv5 of A know enr of B
    const discovery: Discv5Discovery = libP2pA._discovery.get("discv5") as Discv5Discovery;
    discovery.discv5.addEnr(enrB);
    await netA.searchSubnetPeers([subnet.toString()]);
    await connected;
    expect(netA.getPeers().length).to.be.equal(1);
  });
});
