import {assert} from "chai";
import {NodejsNode} from "../../../../src/network/nodejs";
import {createNode} from "../../../utils/network";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] nodejs libp2p", () => {

  it("can start and stop a node", async () => {
    const node: NodejsNode = await createNode(multiaddr);
    await node.start();
    assert.equal(node.isStarted(), true);
    await node.stop();
    assert.equal(node.isStarted(), false);
  });

  it("can connect/disconnect to a peer", async function ()  {
    this.timeout(5000);
    // setup
    const nodeA: NodejsNode = await createNode(multiaddr);
    const nodeB: NodejsNode = await createNode(multiaddr);

    await Promise.all([
      nodeA.start(),
      nodeB.start(),
    ]);

    nodeA.peerStore.addressBook.add(nodeB.peerId, nodeB.multiaddrs);

    // connect
    await Promise.all(
      [
        new Promise((resolve, reject) => {
          const t = setTimeout(reject, 1000, "connection timed out");
          nodeB.connectionManager.once("peer:connect", () => {
            clearTimeout(t);
            resolve();
          });
        }),
        nodeA.dial(nodeB.peerId),
      ]
    );

    // test connection
    assert(nodeA.connectionManager.get(nodeB.peerId));
    assert(nodeB.connectionManager.get(nodeA.peerId));

    // disconnect
    const p = new Promise(resolve => nodeB.connectionManager.once("peer:disconnect", resolve));
    await new Promise(resolve => setTimeout(resolve, 100));
    await nodeA.hangUp(nodeB.peerId);
    await p;

    // test disconnection
    assert(!nodeA.connectionManager.get(nodeB.peerId));
    assert(!nodeB.connectionManager.get(nodeA.peerId));
    // teardown
    await Promise.all([
      nodeA.stop(),
      nodeB.stop()
    ]);
  });
});
