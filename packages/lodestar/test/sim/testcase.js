const Libp2p = require("libp2p");
const TCP = require("libp2p-tcp");
const MPLEX = require("libp2p-mplex");
const {NOISE} = require("libp2p-noise");

async function createNode() {
  return Libp2p.create({
    modules: {
      transport: [TCP],
      streamMuxer: [MPLEX],
      connEncryption: [NOISE],
    },
    addresses: {
      listen: ["/ip4/127.0.0.1/tcp/0"],
    },
  });
}

(async function () {
  // create nodes
  const nodes = await Promise.all(Array.from({length: 2}, createNode));

  // start nodes
  await Promise.all(nodes.map((n) => n.start()));

  // connect node 0 to node 1
  nodes[0].peerStore.addressBook.add(nodes[1].peerId, nodes[1].multiaddrs);
  await nodes[0].dial(nodes[1].peerId);

  // hangUp and stop
  await Promise.all(
    nodes
      .map((n) => n.stop())
      .concat([
        nodes[0].hangUp(nodes[1].peerId), // not awaited
      ])
  );
})();
