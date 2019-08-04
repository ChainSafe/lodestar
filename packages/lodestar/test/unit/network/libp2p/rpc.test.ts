import {assert} from "chai";
import BN from "bn.js";
import promisify from "promisify-es6";

import {Hello, ResponseBody} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {NetworkRpc} from "../../../../src/network/libp2p/rpc";

import {createNode} from "./util";
import {NodejsNode} from "../../../../src/network/libp2p/nodejs";

import {Method} from "../../../../src/constants";
import {ILogger, WinstonLogger} from "../../../../src/logger";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] rpc", () => {
  let nodeA: NodejsNode, nodeB: NodejsNode,
    rpcA: NetworkRpc, rpcB: NetworkRpc;
  let logger: ILogger = new WinstonLogger();
  beforeEach(async () => {
    // setup
    nodeA = await createNode(multiaddr);
    nodeB = await createNode(multiaddr);
    await Promise.all([
      promisify(nodeA.start.bind(nodeA))(),
      promisify(nodeB.start.bind(nodeB))(),
    ]);
    const networkOptions = {
      maxPeers: 10,
      multiaddrs: [],
      bootnodes: [],
      rpcTimeout: 5000,
      connectTimeout: 5000,
      disconnectTimeout: 5000,
    };
    rpcA = new NetworkRpc(networkOptions, {config, libp2p: nodeA, logger});
    rpcB = new NetworkRpc(networkOptions, {config, libp2p: nodeB, logger});
    await Promise.all([
      rpcA.start(),
      rpcB.start(),
    ]);
  });
  afterEach(async () => {
    // teardown
    await Promise.all([
      rpcA.stop(),
      rpcB.stop(),
    ]);
    await Promise.all([
      promisify(nodeA.stop.bind(nodeA))(),
      promisify(nodeB.stop.bind(nodeB))(),
    ]);
  });

  //prevents tests from exiting
  // it('default props should work', async function() {
  //   try {
  //     for(let i = 0; i < networkDefaults.multiaddrs.length; i++) {
  //       const node = await createNode(networkDefaults.multiaddrs[i]);
  //     }
  //     expect(networkDefaults.maxPeers).to.be.greaterThan(0);
  //     expect(networkDefaults.rpcTimeout).to.be.greaterThan(0);
  //   } catch (e) {
  //     expect.fail(e);
  //   }
  // });

  it("creates a peer when when new libp2p peers are added", async function () {
    this.timeout(3000);
    await promisify(nodeA.dial.bind(nodeA))(nodeB.peerInfo);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcA.once("peer:connect", () => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      assert.fail("no peer connected");
    }
  });
  it("can list peers", async function () {
    this.timeout(3000);
    await promisify(nodeA.dial.bind(nodeA))(nodeB.peerInfo);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcA.once("peer:connect", () => {
          clearTimeout(t);
          resolve();
        });
      });
      assert.equal(rpcA.getPeers().length, 1);
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }
  });
  it("can remove a peer", async function () {
    this.timeout(3000)
    await promisify(nodeA.dial.bind(nodeA))(nodeB.peerInfo);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcA.once("peer:connect", () => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }
    try {
      const p = new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcA.once("peer:disconnect", () => {
          clearTimeout(t);
          resolve();
        });
      });
      promisify(nodeA.hangUp.bind(nodeA))(nodeB.peerInfo);
      await p
    } catch (e) {
      assert.fail(e, null, "disconnection event not triggered");
    }
  });
  it("can send/receive messages from connected peers", async function () {
    this.timeout(6000);
    await promisify(nodeA.dial.bind(nodeA))(nodeB.peerInfo);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcB.once("peer:connect", () => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }
    // send hello from A to B, await hello response
    rpcB.once("request", (peerInfo, method, id, body) => {
      rpcB.sendResponse(id, 0, body as ResponseBody);
    });
    try {
      const helloExpected: Hello = {
        networkId: new BN(0),
        chainId: 0,
        latestFinalizedRoot: Buffer.alloc(32),
        latestFinalizedEpoch: 0,
        bestRoot: Buffer.alloc(32),
        bestSlot: 0,
      };
      const helloActual = await rpcA.sendRequest<Hello>(rpcA.getPeers()[0], Method.Hello, helloExpected);
      assert.deepEqual(JSON.stringify(helloActual), JSON.stringify(helloExpected));
    } catch (e) {
      assert.fail("hello not received");
    }
    // send hello from B to A, await hello response
    rpcA.once("request", (peerInfo, method, id, body) => {
      rpcA.sendResponse(id, 0, body as ResponseBody);
    });
    try {
      const helloExpected: Hello = {
        networkId: new BN(0),
        chainId: 0,
        latestFinalizedRoot: Buffer.alloc(32),
        latestFinalizedEpoch: 0,
        bestRoot: Buffer.alloc(32),
        bestSlot: 0,
      };
      const helloActual = await rpcB.sendRequest<Hello>(rpcB.getPeers()[0], Method.Hello, helloExpected);
      assert.deepEqual(JSON.stringify(helloActual), JSON.stringify(helloExpected));
    } catch (e) {
      assert.fail("hello not received");
    }
  });
});
