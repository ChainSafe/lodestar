import {assert} from "chai";
import {sleep} from "@chainsafe/lodestar-utils";
import {NodejsNode} from "../../../../src/network/nodejs";
import {createNode} from "../../../utils/network";
import {Libp2pEvent} from "../../../../src/constants";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] nodejs libp2p", () => {
  it("can start and stop a node", async () => {
    const node: NodejsNode = await createNode(multiaddr);
    await node.start();
    assert.equal(node.isStarted(), true);
    await node.stop();
    assert.equal(node.isStarted(), false);
  });

  it("can connect/disconnect to a peer", async function () {
    this.timeout(5000);
    // setup
    const nodeA: NodejsNode = await createNode(multiaddr);
    const nodeB: NodejsNode = await createNode(multiaddr);

    await Promise.all([nodeA.start(), nodeB.start()]);

    await nodeA.peerStore.addressBook.add(nodeB.peerId, nodeB.multiaddrs);

    // connect
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(reject, 1000, "connection timed out");
        nodeB.connectionManager.once(Libp2pEvent.peerConnect, () => {
          clearTimeout(t);
          resolve();
        });
      }),
      nodeA.dial(nodeB.peerId),
    ]);

    // test connection
    assert(nodeA.connectionManager.get(nodeB.peerId), "nodeA should have connection to nodeB");
    assert(nodeB.connectionManager.get(nodeA.peerId), "nodeB should have connection to nodeA");

    // disconnect
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    const p = new Promise((resolve) => nodeB.connectionManager.once(Libp2pEvent.peerDisconnect, resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await nodeA.hangUp(nodeB.peerId);
    await p;

    // test disconnection
    assert(!nodeA.connectionManager.get(nodeB.peerId), "nodeA should NOT have connection to nodeB");
    await sleep(200);
    assert(!nodeB.connectionManager.get(nodeA.peerId), "nodeB should NOT have connection to nodeA");

    // teardown
    await Promise.all([nodeA.stop(), nodeB.stop()]);
  });
});
