import {assert} from "chai";
// @ts-ignore
import promisify from "promisify-es6";
import {Status, ResponseBody} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {ReqResp} from "../../../src/network/reqResp";
import {describe, it, beforeEach, afterEach} from "mocha";
import {createNode} from "./util";
import {NodejsNode} from "../../../src/network/nodejs";
import {ILogger, WinstonLogger} from "../../../src/logger";
import {INetworkOptions} from "../../../src/network/options";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] rpc", () => {

  let nodeA: NodejsNode, nodeB: NodejsNode,
    rpcA: ReqResp, rpcB: ReqResp;
  const logger: ILogger = new WinstonLogger();

  beforeEach(async () => {
    // setup
    nodeA = await createNode(multiaddr);
    nodeB = await createNode(multiaddr);
    await Promise.all([
      // @ts-ignore
      promisify(nodeA.start.bind(nodeA))(),
      // @ts-ignore
      promisify(nodeB.start.bind(nodeB))(),
    ]);
    const networkOptions: INetworkOptions = {
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
  afterEach(async function () {
    // teardown
    this.timeout(10000);
    await Promise.all([
      rpcA.stop(),
      rpcB.stop(),
    ]);
    await Promise.all([
      // @ts-ignore
      promisify(nodeA.stop.bind(nodeA))(),
      // @ts-ignore
      promisify(nodeB.stop.bind(nodeB))(),
    ]);
  });

  it("can send/receive messages from connected peers", async function () {
    this.timeout(6000);
    // @ts-ignore
    await promisify(nodeA.dial.bind(nodeA))(nodeB.peerInfo);
    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        // @ts-ignore
        nodeB.once("peer:connect", () => {
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
      const statusExpected: Status = {
        headForkVersion: Buffer.alloc(4),
        finalizedRoot: Buffer.alloc(32),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32),
        headSlot: 0,
      };
      // @ts-ignore
      const statusActual = await rpcA.status(nodeB.peerInfo, statusExpected);
      assert.deepEqual(JSON.stringify(statusActual), JSON.stringify(statusExpected));
    } catch (e) {
      assert.fail("status not received");
    }
    // send hello from B to A, await hello response
    rpcA.once("request", (peerInfo, method, id, body) => {
      setTimeout(() => {
        rpcA.sendResponse(id, null, body as ResponseBody);
      }, 100);
    });
    try {
      const statusExpected: Status = {
        headForkVersion: Buffer.alloc(4),
        finalizedRoot: Buffer.alloc(32),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32),
        headSlot: 0,
      };

      // @ts-ignore
      const statusActual = await rpcB.status(nodeA.peerInfo, statusExpected);
      assert.deepEqual(JSON.stringify(statusActual), JSON.stringify(statusExpected));
    } catch (e) {
      assert.fail("statu not received");
    }
  });
});
