import {assert, expect} from "chai";
import BN from "bn.js";
import promisify from "promisify-es6";

import {config} from "../../../../src/config/presets/mainnet";
import {HobbitsConnectionHandler} from "../../../../src/network/hobbits/hobbitsConnectionHandler";

import {NodejsNode} from "../../../../src/network/libp2p/nodejs";
import {Method} from "../../../../src/constants";
import {Hello} from "../../../../src/types";
import {ILogger, WinstonLogger} from "../../../../src/logger";

import networkDefaults from "../../../../src/network/defaults";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[hobbits] HobbitsConnectionHandler", () => {
  let rpcA: HobbitsConnectionHandler, rpcB: HobbitsConnectionHandler;
  let logger: ILogger = new WinstonLogger();
  beforeEach(async () => {
    // setup
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

  it("creates a peer after dialing for a new peer.", async function () {
    this.timeout(4000);
    // dial for rpc
    // check if the peer is added in the peerlist
    try {
      new Promise((resolve, reject) => {
        const t = setTimeout(reject, 3000);
        rpcA.once("peer:connect", (peerInfo) => {
          console.log(`Got peer connect in rpcA`);
          clearTimeout(t);
          resolve();
        // });
        });
      });
    } catch (e) {
      console.log(e);
      assert.fail(e, null, "no peer connected");
    }

    await rpcA.dialForRpc(rpcB.getPeerInfo());
    assert.equal(rpcA.getPeers().length, 1);
  });

  /*it("can list peers", async function () {
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
      rpcB.sendResponse(id, 0, body)
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
      rpcA.sendResponse(id, 0, body)
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
  });*/
});
