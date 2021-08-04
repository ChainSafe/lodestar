import PeerId from "peer-id";
import {Multiaddr} from "multiaddr";
import {expect} from "chai";
import {fromHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {ForkName} from "@chainsafe/lodestar-params";
import {createEnr, createPeerId} from "@chainsafe/lodestar-cli/src/config";
import {Method, Version, Encoding} from "../../../src/network/reqresp/types";
import {defaultNetworkOptions} from "../../../src/network/options";
import {formatProtocolId, parseProtocolId} from "../../../src/network/reqresp/utils";
import {createNodeJsLibp2p, getAgentVersionFromPeerStore, isLocalMultiAddr} from "../../../src/network";
import {getCurrentAndNextFork} from "../../../src/network/forks";

describe("Test isLocalMultiAddr", () => {
  it("should return true for 127.0.0.1", () => {
    const multi0 = new Multiaddr("/ip4/127.0.0.1/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.be.true;
  });

  it("should return false for 0.0.0.0", () => {
    const multi0 = new Multiaddr("/ip4/0.0.0.0/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.be.false;
  });
});

describe("ReqResp protocolID parse / render", () => {
  const testCases: {
    method: Method;
    version: Version;
    encoding: Encoding;
    protocolId: string;
  }[] = [
    {
      method: Method.Status,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      protocolId: "/eth2/beacon_chain/req/status/1/ssz_snappy",
    },
    {
      method: Method.BeaconBlocksByRange,
      version: Version.V2,
      encoding: Encoding.SSZ_SNAPPY,
      protocolId: "/eth2/beacon_chain/req/beacon_blocks_by_range/2/ssz_snappy",
    },
  ];

  for (const {method, encoding, version, protocolId} of testCases) {
    it(`Should render ${protocolId}`, () => {
      expect(formatProtocolId(method, version, encoding)).to.equal(protocolId);
    });

    it(`Should parse ${protocolId}`, () => {
      expect(parseProtocolId(protocolId)).to.deep.equal({method, version, encoding});
    });
  }
});

describe("getAgentVersionFromPeerStore", () => {
  it("should get the peer's AgentVersion", async function () {
    this.timeout(0);
    const peerId = await createPeerId();
    const libp2p = await createNodeJsLibp2p(
      peerId,
      {
        discv5: {
          enabled: false,
          enr: createEnr(peerId),
          bindAddr: "/ip4/127.0.0.1/udp/0",
          bootEnrs: [],
        },
        localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
        targetPeers: defaultNetworkOptions.targetPeers,
        maxPeers: defaultNetworkOptions.maxPeers,
      },
      {disablePeerDiscovery: true}
    );

    const testAgentVersion = fromHexString("0x1234");
    const numPeers = 200;
    const peers: PeerId[] = [];

    // Write peers to peerStore
    for (let i = 0; i < numPeers; i++) {
      const peerId = await createPeerId();
      libp2p.peerStore.metadataBook._setValue(peerId, "AgentVersion", testAgentVersion);
      peers.push(peerId);
    }

    // start the benchmark
    const start = Date.now();
    for (const peer of peers) {
      const version = getAgentVersionFromPeerStore(peer, libp2p.peerStore.metadataBook);
      expect(version).to.be.equal(new TextDecoder().decode(testAgentVersion));
    }
    const timeDiff = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`getAgentVersionFromPeerStore x${numPeers}: ${timeDiff} ms`);
  });
});

describe("getCurrentAndNextFork", function () {
  const altairEpoch = config.forks.altair.epoch;
  afterEach(() => {
    config.forks.altair.epoch = altairEpoch;
  });

  it("should return no next fork if altair epoch is infinity", () => {
    config.forks.altair.epoch = Infinity;
    const {currentFork, nextFork} = getCurrentAndNextFork(config, 0);
    expect(currentFork.name).to.be.equal(ForkName.phase0);
    expect(nextFork).to.be.undefined;
  });

  it("should return altair as next fork", () => {
    config.forks.altair.epoch = 1000;
    let forks = getCurrentAndNextFork(config, 0);
    expect(forks.currentFork.name).to.be.equal(ForkName.phase0);
    if (forks.nextFork) {
      expect(forks.nextFork.name).to.be.equal(ForkName.altair);
    } else {
      expect.fail("No next fork");
    }

    forks = getCurrentAndNextFork(config, 1000);
    expect(forks.currentFork.name).to.be.equal(ForkName.altair);
    expect(forks.nextFork).to.be.undefined;
  });
});
