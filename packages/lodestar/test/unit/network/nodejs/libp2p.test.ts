import {assert} from "chai";
import promisify from "promisify-es6";

import {NodejsNode} from "../../../../src/network/nodejs";
import {createNode} from "../util";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] nodejs libp2p", () => {
  it("can start and stop a node", async () => {
    const node: NodejsNode = await createNode(multiaddr);
    await promisify(node.start.bind(node))();
    assert.equal(node.isStarted(), true);
    await promisify(node.stop.bind(node))();
    assert.equal(node.isStarted(), false);
  });
  it("can connect/disconnect to a peer", async function ()  {
    this.timeout(35000)
    // setup
    const nodeA: NodejsNode = await createNode(multiaddr);
    const nodeB: NodejsNode = await createNode(multiaddr);

    await Promise.all([
      promisify(nodeA.start.bind(nodeA))(),
      promisify(nodeB.start.bind(nodeB))(),
    ]);

    // connect
    await promisify(nodeA.dial.bind(nodeA))(nodeB.peerInfo);
    await new Promise((resolve, reject) => {
      const t = setTimeout(reject, 1000);
      nodeB.once("peer:connect", () => {
        clearTimeout(t);
        resolve();
      });
    });


    // test connection
    assert(nodeA.peerBook.get(nodeB.peerInfo).isConnected());
    assert(nodeB.peerBook.get(nodeA.peerInfo).isConnected());
    console.log("DISCONNECT")
    // disconnect
    const p = new Promise(resolve => nodeB.once("peer:disconnect", resolve));
    await promisify(nodeA.hangUp.bind(nodeA))(nodeB.peerInfo);
    await p

    // test disconnection
    assert(!nodeA.peerBook.get(nodeB.peerInfo).isConnected());
    assert(!nodeB.peerBook.get(nodeA.peerInfo).isConnected());
    // teardown
    await Promise.all([
      promisify(nodeA.stop.bind(nodeA))(),
      promisify(nodeB.stop.bind(nodeB))(),
    ]);
  });
});
