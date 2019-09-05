import {assert} from "chai";
import BN from "bn.js";
import promisify from "promisify-es6";

import {Hello, ResponseBody} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import {ReqResp} from "../../../src/network/reqResp";

import {createNode} from "./util";
import {NodejsNode} from "../../../src/network/nodejs";

import {Method} from "../../../src/constants";
import {ILogger, WinstonLogger} from "../../../src/logger";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] rpc", () => {
  let nodeA: NodejsNode, nodeB: NodejsNode,
    rpcA: ReqResp, rpcB: ReqResp;
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
    rpcA = new ReqResp(networkOptions, {config, libp2p: nodeA, logger});
    rpcB = new ReqResp(networkOptions, {config, libp2p: nodeB, logger});
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
  it("can send/receive messages from connected peers", async function () {
    this.timeout(6000);
    await promisify(nodeA.dial.bind(nodeA))(nodeB.peerInfo);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        nodeB.once("peer:connect", (p) => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }
    // send hello from A to B, await hello response
    rpcB.once("request", (peerInfo, method, id, body) => {
      setTimeout(() => {
        rpcB.sendResponse(id, null, body as ResponseBody);
      }, 100);
    });
    try {
      const helloExpected: Hello = {
        forkVersion: Buffer.alloc(4),
        finalizedRoot: Buffer.alloc(32),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32),
        headSlot: 0,
      };
      const helloActual = await rpcA.hello(nodeB.peerInfo, helloExpected);
      assert.deepEqual(JSON.stringify(helloActual), JSON.stringify(helloExpected));
    } catch (e) {
      assert.fail("hello not received");
    }
    // send hello from B to A, await hello response
    rpcA.once("request", (peerInfo, method, id, body) => {
      setTimeout(() => {
        rpcA.sendResponse(id, null, body as ResponseBody);
      }, 100);
    });
    try {
      const helloExpected: Hello = {
        forkVersion: Buffer.alloc(4),
        finalizedRoot: Buffer.alloc(32),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32),
        headSlot: 0,
      };
      const helloActual = await rpcB.hello(nodeA.peerInfo, helloExpected);
      assert.deepEqual(JSON.stringify(helloActual), JSON.stringify(helloExpected));
    } catch (e) {
      assert.fail("hello not received");
    }
  });
});
