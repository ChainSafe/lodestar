import {assert} from "chai";

import {BeaconBlocksByRangeRequest, SignedBeaconBlock, Slot, Status} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ReqResp} from "../../../src/network/reqResp";
import {afterEach, beforeEach, describe, it} from "mocha";
import {NodejsNode} from "../../../src/network/nodejs";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {INetworkOptions} from "../../../src/network/options";
import {generateEmptySignedBlock} from "../../utils/block";
import {createNode} from "../../utils/network";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] rpc", () => {

  let nodeA: NodejsNode, nodeB: NodejsNode,
    rpcA: ReqResp, rpcB: ReqResp;
  const logger: ILogger = new WinstonLogger();

  beforeEach(async function() {
    this.timeout(10000);
    // setup
    nodeA = await createNode(multiaddr);
    nodeB = await createNode(multiaddr);
    await Promise.all([
      nodeA.start(),
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
    try {
      await Promise.all([
        nodeA.dial(nodeB.peerInfo),
        new Promise((resolve, reject) => {
          const t = setTimeout(reject, 2000);
          nodeB.once("peer:connect", () => {
            clearTimeout(t);
            resolve();
          });
        })
      ]);
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }
  });
  afterEach(async function () {
    // teardown
    this.timeout(10000);
    await Promise.all([
      nodeA.stop(),
      nodeB.stop()
    ]);
    await Promise.all([
      rpcA.stop(),
      rpcB.stop(),
    ]);
  });

  it("can send/receive status messages from connected peers", async function () {
    this.timeout(6000);
    // send status from A to B, await status response
    rpcB.once("request", (peerInfo, method, id, body) => {
      setTimeout(() => {
        rpcB.sendResponse(id, null, [body as Status]);
      }, 100);
    });
    try {
      const statusExpected: Status = {
        forkDigest: Buffer.alloc(4),
        finalizedRoot: Buffer.alloc(32),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32),
        headSlot: 0,
      };
      const statusActual = await rpcA.status(nodeB.peerInfo, statusExpected);
      assert.deepEqual(statusActual, statusExpected);
    } catch (e) {
      assert.fail("status not received");
    }
    // send status from B to A, await status response
    rpcA.once("request", (peerInfo, method, id, body) => {
      setTimeout(() => {
        rpcA.sendResponse(id, null, [body as Status]);
      }, 100);
    });
    try {
      const statusExpected: Status = {
        forkDigest: Buffer.alloc(4),
        finalizedRoot: Buffer.alloc(32),
        finalizedEpoch: 0,
        headRoot: Buffer.alloc(32),
        headSlot: 0,
      };

      const statusActual = await rpcB.status(nodeA.peerInfo, statusExpected);
      assert.deepEqual(statusActual, statusExpected);
    } catch (e) {
      assert.fail("status not received");
    }
  });

  it("can handle multiple block requests from connected peers at the same time", async function () {
    this.timeout(6000);
    const NUM_REQUEST = 5;
    const generateBlockForSlot = (slot: Slot): SignedBeaconBlock => {
      const block = generateEmptySignedBlock();
      block.message.slot = slot;
      return block;
    };
    // send block by range requests from A to B
    rpcB.on("request", (peerInfo, method, id, body) => {
      const requestBody = body as BeaconBlocksByRangeRequest;
      const blocks: SignedBeaconBlock[] = [];
      for (let i = requestBody.startSlot; i < + requestBody.startSlot + requestBody.count; i++) {
        blocks.push(generateBlockForSlot(i));
      }
      rpcB.sendResponse(id, null, blocks);
    });
    try {
      const reqs: BeaconBlocksByRangeRequest[] = [];
      for (let i = 0; i < NUM_REQUEST; i++) {
        reqs.push({
          startSlot: i*100,
          count: 10,
          step: 1
        });
      }
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

  it("allow empty lists in streamed response", async function() {
    this.timeout(6000);
    rpcB.on("request", (peerInfo, method, id) => {
      rpcB.sendResponse(id, null, []);
    });

    const request: BeaconBlocksByRangeRequest = {
      startSlot: 100,
      count: 10,
      step: 1
    };

    const response = await rpcA.beaconBlocksByRange(nodeB.peerInfo, request);
    assert.deepEqual(response, []);
  });
});
