import {assert} from "chai";

import {Status, ResponseBody, SignedBeaconBlock, Slot, BeaconBlocksByRangeRequest} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ReqResp} from "../../../src/network/reqResp";
import {describe, it, beforeEach, afterEach} from "mocha";
import {createNode} from "./util";
import {NodejsNode} from "../../../src/network/nodejs";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {INetworkOptions} from "../../../src/network/options";
import {generateEmptySignedBlock} from "../../utils/block";

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
      nodeA.start(),
      // @ts-ignore
      nodeB.start()
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
      nodeA.stop(),
      // @ts-ignore
      nodeB.stop()
    ]);
  });

  it("can send/receive status messages from connected peers", async function () {
    this.timeout(6000);
    await nodeA.dial(nodeB.peerInfo)
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
    // send status from A to B, await status response
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
      assert.deepEqual(statusActual, statusExpected);
    } catch (e) {
      console.log(e)
      assert.fail("status not received");
    }
    // send status from B to A, await status response
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
      assert.deepEqual(statusActual, statusExpected);
    } catch (e) {
      assert.fail("status not received");
    }
  });

  it("can handle multiple block requests from connected peers at the same time", async function () {
    this.timeout(6000);
    const NUM_REQUEST = 5;
    await nodeA.dial(nodeB.peerInfo)
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
    const generateBlockForSlot = (slot: Slot): SignedBeaconBlock => {
      const block = generateEmptySignedBlock();
      block.message.slot = slot;
      return block;
    };
    // send status from A to B, await status response
    rpcB.on("request", (peerInfo, method, id, body) => {
      const requestBody = body as BeaconBlocksByRangeRequest;
      const blocks: SignedBeaconBlock[] = [];
      for (let i = requestBody.startSlot; i < + requestBody.startSlot + requestBody.count; i++) {
        blocks.push(generateBlockForSlot(i));
      }
      setTimeout(() => {
        rpcB.sendResponse(id, null, blocks);
      }, 100);
    });
    try {
      const reqs: BeaconBlocksByRangeRequest[] = [];
      for (let i = 0; i < NUM_REQUEST; i++) {
        reqs.push({
          headBlockRoot: Buffer.alloc(32),
          startSlot: i*100,
          count: 10,
          step: 1
        });
      }
      // @ts-ignore
      const resps = await Promise.all(reqs.map(req => rpcA.beaconBlocksByRange(nodeB.peerInfo, req)));
      let reqIndex = 0;
      for (const resp of resps) {
        let blockIndex = 0;
        for (const block of resp) {
          assert.deepEqual(block, generateBlockForSlot(reqs[reqIndex].startSlot + blockIndex));
          blockIndex++;
        }
        reqIndex ++;
      }

    } catch (e) {
      assert.fail(`Cannot receive response, error: ${e.message}`);
    }
  });
});
