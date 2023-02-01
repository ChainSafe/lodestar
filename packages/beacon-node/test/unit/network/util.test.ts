import {multiaddr} from "@multiformats/multiaddr";
import {expect} from "chai";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {generateKeypair, KeypairType, SignableENR} from "@chainsafe/discv5";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {createNodeJsLibp2p, isLocalMultiAddr} from "../../../src/network/index.js";
import {getCurrentAndNextFork} from "../../../src/network/forks.js";

describe("Test isLocalMultiAddr", () => {
  it("should return true for 127.0.0.1", () => {
    const multi0 = multiaddr("/ip4/127.0.0.1/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.equal(true);
  });

  it("should return false for 0.0.0.0", () => {
    const multi0 = multiaddr("/ip4/0.0.0.0/udp/30303");
    expect(isLocalMultiAddr(multi0)).to.equal(false);
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

describe("createNodeJsLibp2p", () => {
  it("should extract bootMultiaddrs from enr with tcp", async function () {
    this.timeout(0);
    const peerId = await createSecp256k1PeerId();
    const enrWithTcp = [
      "enr:-LK4QDiPGwNomqUqNDaM3iHYvtdX7M5qngson6Qb2xGIg1LwC8-Nic0aQwO0rVbJt5xp32sRE3S1YqvVrWO7OgVNv0kBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpA7CIeVAAAgCf__________gmlkgnY0gmlwhBKNA4qJc2VjcDI1NmsxoQKbBS4ROQ_sldJm5tMgi36qm5I5exKJFb4C8dDVS_otAoN0Y3CCIyiDdWRwgiMo",
    ];
    const bootMultiaddrs: string[] = [];
    await createNodeJsLibp2p(
      peerId,
      {
        connectToDiscv5Bootnodes: true,
        discv5: {
          enabled: false,
          enr: SignableENR.createV4(generateKeypair(KeypairType.Secp256k1)),
          bindAddr: "/ip4/127.0.0.1/udp/0",
          bootEnrs: enrWithTcp,
        },
        bootMultiaddrs,
        localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
        targetPeers: defaultNetworkOptions.targetPeers,
        maxPeers: defaultNetworkOptions.maxPeers,
      },
      {disablePeerDiscovery: true}
    );
    expect(bootMultiaddrs.length).to.be.equal(1);
    expect(bootMultiaddrs[0]).to.be.equal(
      "/ip4/18.141.3.138/tcp/9000/p2p/16Uiu2HAm5rokhpCBU7yBJHhMKXZ1xSVWwUcPMrzGKvU5Y7iBkmuK"
    );
  });

  it("should not extract bootMultiaddrs from enr without tcp", async function () {
    this.timeout(0);
    const peerId = await createSecp256k1PeerId();
    const enrWithoutTcp = [
      "enr:-Ku4QCFQW96tEDYPjtaueW3WIh1CB0cJnvw_ibx5qIFZGqfLLj-QajMX6XwVs2d4offuspwgH3NkIMpWtCjCytVdlywGh2F0dG5ldHOIEAIAAgABAUyEZXRoMpCi7FS9AQAAAAAiAQAAAAAAgmlkgnY0gmlwhFA4VK6Jc2VjcDI1NmsxoQNGH1sJJS86-0x9T7qQewz9Wn9zlp6bYxqqrR38JQ49yIN1ZHCCIyg",
    ];
    const bootMultiaddrs: string[] = [];
    await createNodeJsLibp2p(
      peerId,
      {
        connectToDiscv5Bootnodes: true,
        discv5: {
          enabled: false,
          enr: SignableENR.createV4(generateKeypair(KeypairType.Secp256k1)),
          bindAddr: "/ip4/127.0.0.1/udp/0",
          bootEnrs: enrWithoutTcp,
        },
        bootMultiaddrs,
        localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
        targetPeers: defaultNetworkOptions.targetPeers,
        maxPeers: defaultNetworkOptions.maxPeers,
      },
      {disablePeerDiscovery: true}
    );
    expect(bootMultiaddrs.length).to.be.equal(0);
  });
});
