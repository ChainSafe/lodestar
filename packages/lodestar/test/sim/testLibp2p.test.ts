import {createPeerId} from "../../src/network";
import {createNodeJsLibp2p} from "../../src/network/nodejs";
import {createEnr} from "@chainsafe/lodestar-cli/src/config";

async function createTestLibp2p(): Promise<LibP2p> {
  const peerId = await createPeerId();

  return await createNodeJsLibp2p(
    peerId,
    {
      discv5: {
        enabled: false,
        enr: await createEnr(peerId),
        bindAddr: "/ip4/127.0.0.1/udp/0",
        bootEnrs: [],
      },
      localMultiaddrs: ["/ip4/127.0.0.1/tcp/0"],
      minPeers: 25,
      maxPeers: 25,
    },
    undefined,
    true
  );
}

describe("Test libp2p", function () {
  it("connect two nodes", async function () {
    this.timeout("10 min");

    const nodes = await Promise.all([createTestLibp2p(), createTestLibp2p()]);

    await Promise.all(nodes.map((node) => node.start()));

    // Connect all nodes with each other
    nodes[0].peerStore.addressBook.add(nodes[1].peerId, nodes[1].multiaddrs);
    await nodes[0].dial(nodes[1].peerId);
    //nodes[1].peerStore.addressBook.add(nodes[0].peerId, nodes[0].multiaddrs);
    //await nodes[1].dial(nodes[0].peerId);

    nodes[0].hangUp(nodes[1].peerId);
    //nodes[1].hangUp(nodes[0].peerId);

    await Promise.all(nodes.map((node) => node.stop()));
  });
});
