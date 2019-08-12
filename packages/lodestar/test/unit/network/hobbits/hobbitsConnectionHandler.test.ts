import {assert, expect} from "chai";
import BN from "bn.js";
import promisify from "promisify-es6";

import {config} from "../../../../src/config/presets/mainnet";
import {HobbitsConnectionHandler} from "../../../../src/network/hobbits/hobbitsConnectionHandler";

import {GossipTopic, Method} from "../../../../src/network/hobbits/constants";
import {BeaconBlock, Hello} from "../../../../src/types";
import {ILogger, WinstonLogger} from "../../../../src/logger";
import {generateEmptyBlock} from "../../../utils/block";
import {deserialize} from "@chainsafe/ssz";


describe("[hobbits] HobbitsConnectionHandler", () => {
  let rpcA: HobbitsConnectionHandler, rpcB: HobbitsConnectionHandler;
  let logger: ILogger = new WinstonLogger();
  beforeEach(async () => {
    // setup
    logger.silent(true);
    const networkOptions = {
      maxPeers: 10,
      multiaddrs: [],
      bootnodes: [],
      rpcTimeout: 5000,
      connectTimeout: 5000,
      disconnectTimeout: 5000,
    };
    rpcA = new HobbitsConnectionHandler({...networkOptions, port: 9000}, {config, logger});
    rpcB = new HobbitsConnectionHandler({...networkOptions, port: 9001}, {config, logger});
    await Promise.all([
      rpcA.start(),
      rpcB.start(),
    ]);
  });

  afterEach(async function(){
    this.timeout(10000);
    // teardown
    await Promise.all([
      rpcA.stop(),
      rpcB.stop(),
    ]);

    logger.silent(false);
  });

  it("creates a peer after dialing for a new peer.", async function () {
    this.timeout(3000);
    try {
      new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcA.once("peer:connect", (peerInfo) => {
          // console.log(`Got peer connect in rpcA`);
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      console.log(e);
      assert.fail(e, null, "no peer connected");
    }

    // dial for rpc
    // check if the peer is added in the peerlist
    await rpcA.dialForRpc(rpcB.getPeerInfo());
    assert.equal(rpcA.getPeers().length, 1);
  });

  it("can remove a peer", async function () {
    this.timeout(4000);
    try {
      new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcA.once("peer:connect", () => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }

    await rpcA.dialForRpc(rpcB.getPeerInfo());
    assert.equal(rpcA.getPeers().length, 1);

    try {
      const p = new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcA.once("peer:disconnect", () => {
          clearTimeout(t);
          resolve();
        });
      });
      await rpcA.removePeer(rpcB.getPeerInfo());
      await p;
    } catch (e) {
      assert.fail(e, null, "disconnection event not triggered");
    }
  });

  it("can send/receive messages from connected peers", async function () {
    this.timeout(6000);
    try {
      new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcB.once("peer:connect", () => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }

    await rpcA.dialForRpc(rpcB.getPeerInfo());
    assert.equal(rpcA.getPeers().length, 1);

    // send hello from A to B, await hello response
    rpcB.once("request", (peerInfo, method, id, body) => {
      // console.log(body);
      rpcB.sendResponse(id, body);
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
      assert.deepEqual(helloActual.toString(), helloExpected.toString());
    } catch (e) {
      console.log(e);
      assert.fail("hello not received");
    }
    // send hello from B to A, await hello response
    rpcA.once("request", (peerInfo, method, id, body) => {
      rpcA.sendResponse(id, body);
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
      assert.deepEqual(helloActual.toString(), helloExpected.toString());
    } catch (e) {
      assert.fail("hello not received");
    }
  });

  it("can send/receive gossip messages from connected peers", async function () {
    this.timeout(6000);
    try {
      new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcB.once("peer:connect", () => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }

    await rpcA.dialForRpc(rpcB.getPeerInfo());
    assert.equal(rpcA.getPeers().length, 1);

    // send hello from A to B, await hello response
    let blockReceived;
    try {
      let p = new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcB.once(`gossip:${GossipTopic.Block}`, decodedMessage => {
          const body = decodedMessage.requestBody;
          blockReceived = deserialize(body, config.types.BeaconBlock);
          clearTimeout(t);
          resolve();
        });
      });
      const blockExpected: BeaconBlock = generateEmptyBlock();
      await rpcA.publishBlock(blockExpected);
      await p;
      assert.deepEqual(blockReceived, blockExpected);
    } catch (e) {
      console.log(e);
      assert.fail("Block could not be published");
    }
  });


  it("can send/receive ping messages from connected peers", async function () {
    this.timeout(6000);
    try {
      new Promise((resolve, reject) => {
        const t = setTimeout(reject, 2000);
        rpcB.once("peer:connect", () => {
          clearTimeout(t);
          resolve();
        });
      });
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }

    await rpcA.dialForRpc(rpcB.getPeerInfo());
    assert.equal(rpcA.getPeers().length, 1);

    // send hello from A to B, await hello response
    try {
      await rpcA.pingPeer(rpcA.getPeers()[0]);
    } catch (e) {
      assert.fail(e, "Block could not be published");
    }
  });

});
