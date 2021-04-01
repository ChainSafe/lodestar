import Multiaddr from "multiaddr";
import {expect} from "chai";
import {
  createNodeJsLibp2p,
  createRpcProtocol,
  getAgentVersionFromPeerStore,
  isLocalMultiAddr,
  parseProtocolId,
} from "../../../src/network";
import {Method, ReqRespEncoding} from "../../../src/constants";
import {createEnr, createPeerId} from "@chainsafe/lodestar-cli/src/config";
import {defaultNetworkOptions} from "../../../src/network/options";
import {fromHexString} from "@chainsafe/ssz";
import {createNode} from "../../utils/network";

describe("Test isLocalMultiAddr", () => {
  it("should return true for 127.0.0.1", () => {
    const multi0 = Multiaddr("/ip4/127.0.0.1/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.be.true;
  });

  it("should return false for 0.0.0.0", () => {
    const multi0 = Multiaddr("/ip4/0.0.0.0/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.be.false;
  });
});

describe("ReqResp protocolID parse / render", () => {
  const testCases: {
    method: Method;
    encoding: ReqRespEncoding;
    version: number;
    protocolId: string;
  }[] = [
    {
      method: Method.Status,
      encoding: ReqRespEncoding.SSZ_SNAPPY,
      version: 1,
      protocolId: "/eth2/beacon_chain/req/status/1/ssz_snappy",
    },
  ];

  for (const {method, encoding, version, protocolId} of testCases) {
    it(`Should render ${protocolId}`, () => {
      expect(createRpcProtocol(method, encoding, version)).to.equal(protocolId);
    });

    it(`Should parse  ${protocolId}`, () => {
      expect(parseProtocolId(protocolId)).to.deep.equal({method, encoding, version});
    });
  }
});

describe("getAgentVersionFromPeerStore benchmark", () => {
  it("should not take longer than 10ms to fetch a peer's AgentVersion", async function () {
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
    const numPeers = 2000;
    for (let i = 0; i < numPeers; i++) {
      const node = await createNode("/ip4/127.0.0.1/tcp/0");
      libp2p.peerStore.addressBook.add(node.peerId, node.multiaddrs);
      libp2p.peerStore.metadataBook._setValue(node.peerId, "AgentVersion", testAgentVersion);

      // start the benchmark
      const start = Date.now();
      const version = getAgentVersionFromPeerStore(node.peerId, libp2p.peerStore);
      const timeDiff = Date.now() - start;
      // TODO: not sure what value to use here.  longest timeDiff i've seen so far is 7ms
      expect(timeDiff).to.be.lt(10);
      expect(version).to.be.equal(testAgentVersion.toString());
    }
  });
});
