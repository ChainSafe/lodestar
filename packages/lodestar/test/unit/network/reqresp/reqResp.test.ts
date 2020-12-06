/* import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {BeaconBlocksByRangeRequest, SignedBeaconBlock, Slot, Status} from "@chainsafe/lodestar-types";
import {assert, expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {TTFB_TIMEOUT} from "../../../../src/constants/network";
import {NodejsNode} from "../../../../src/network/nodejs/bundle";
import {INetworkOptions} from "../../../../src/network/options";
import {
  IPeerMetadataStore,
  IRpcScoreTracker,
  Libp2pPeerMetadataStore,
  SimpleRpcScoreTracker,
} from "../../../../src/network/peers";
import {ReqResp, sendResponse, sendResponseStream} from "../../../../src/network/reqresp";
import {generateEmptySignedBlock} from "../../../utils/block";
import {silentLogger} from "../../../utils/logger";
import {createNode} from "../../../utils/network";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

describe("[network] rpc", () => {
  const logger = silentLogger;
  const sandbox = sinon.createSandbox();
  let nodeA: NodejsNode, nodeB: NodejsNode, rpcA: ReqResp, rpcB: ReqResp;
  let metaA: SinonStubbedInstance<IPeerMetadataStore>;
  let metaB: SinonStubbedInstance<IPeerMetadataStore>;
  let blockProviderScoresStub: SinonStubbedInstance<IRpcScoreTracker>;

  const networkOptions: INetworkOptions = {
    maxPeers: 10,
    minPeers: 10,
    localMultiaddrs: [],
    bootMultiaddrs: [],
    rpcTimeout: 5000,
    connectTimeout: 5000,
    disconnectTimeout: 5000,
  };
  beforeEach(async function () {
    this.timeout(10000);
    // setup
    nodeA = await createNode(multiaddr);
    nodeB = await createNode(multiaddr);
    metaA = sinon.createStubInstance(Libp2pPeerMetadataStore);
    metaB = sinon.createStubInstance(Libp2pPeerMetadataStore);
    blockProviderScoresStub = sinon.createStubInstance(SimpleRpcScoreTracker);
    await Promise.all([nodeA.start(), nodeB.start()]);

    rpcA = new ReqResp(networkOptions, {
      config,
      libp2p: nodeA,
      logger: logger,
      blockProviderScores: blockProviderScoresStub,
      peerMetadata: metaA,
    });
    rpcB = new ReqResp(networkOptions, {
      config,
      libp2p: nodeB,
      logger: logger,
      blockProviderScores: blockProviderScoresStub,
      peerMetadata: metaB,
    });
    await Promise.all([rpcA.start(), rpcB.start()]);
    try {
      nodeA.peerStore.addressBook.add(nodeB.peerId, nodeB.multiaddrs);
      await Promise.all([
        nodeA.dial(nodeB.peerId),
        new Promise((resolve, reject) => {
          const t = setTimeout(reject, 2000);
          nodeB.connectionManager.once("peer:connect", () => {
            clearTimeout(t);
            resolve();
          });
        }),
      ]);
    } catch (e) {
      assert.fail(e, null, "connection event not triggered");
    }
  });
  afterEach(async function () {
    // teardown
    this.timeout(10000);
    await Promise.all([nodeA.stop(), nodeB.stop()]);
    await Promise.all([rpcA.stop(), rpcB.stop()]);
    sandbox.restore();
  });

  it("can send/receive status messages from connected peers", async function () {
    this.timeout(10000);
    // send status from A to B, await status response
    rpcB.once("request", (request, peerId, sink) => {
      setTimeout(async () => {
        await sendResponse(
          {config, logger: silentLogger},
          request.id,
          request.method,
          request.encoding,
          sink,
          null,
          request.body as Status
        );
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
      const statusActual = await rpcA.status(nodeB.peerId, statusExpected);
      assert.deepEqual(statusActual, statusExpected);
    } catch (e) {
      assert.fail("status not received");
    }
    // send status from B to A, await status response
    rpcA.once("request", (request, peerId, sink) => {
      setTimeout(async () => {
        await sendResponse(
          {config, logger: silentLogger},
          request.id,
          request.method,
          request.encoding,
          sink,
          null,
          request.body as Status
        );
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

      const statusActual = await rpcB.status(nodeA.peerId, statusExpected);
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
    rpcB.on("request", async (request, peerId, sink) => {
      const requestBody = request.body as BeaconBlocksByRangeRequest;
      const blocks: SignedBeaconBlock[] = [];
      for (let i = requestBody.startSlot; i < +requestBody.startSlot + requestBody.count; i++) {
        blocks.push(generateBlockForSlot(i));
      }
      await sendResponseStream(
        {config, logger: silentLogger},
        request.id,
        request.method,
        request.encoding,
        sink,
        null,
        (async function* () {
          yield* blocks;
        })()
      );
    });
    try {
      const reqs: BeaconBlocksByRangeRequest[] = [];
      for (let i = 0; i < NUM_REQUEST; i++) {
        reqs.push({
          startSlot: i * 100,
          count: 10,
          step: 1,
        });
      }
      const resps = await Promise.all(reqs.map((req) => rpcA.beaconBlocksByRange(nodeB.peerId, req)));
      let reqIndex = 0;
      for (const resp of resps) {
        let blockIndex = 0;
        for (const block of resp!) {
          assert.deepEqual(block, generateBlockForSlot(reqs[reqIndex].startSlot + blockIndex));
          blockIndex++;
        }
        reqIndex++;
      }
    } catch (e) {
      assert.fail(`Cannot receive response, error: ${e.message}`);
    }
  });

  it("allow empty lists in streamed response", async function () {
    this.timeout(6000);
    rpcB.on("request", async (request, peerId, sink) => {
      await sendResponseStream(
        {config, logger: silentLogger},
        request.id,
        request.method,
        request.encoding,
        sink,
        null,
        (async function* (): any {
          if (request.id === "-1") yield null;
        })()
      );
    });

    const request: BeaconBlocksByRangeRequest = {
      startSlot: 100,
      count: 10,
      step: 1,
    };

    const response = await rpcA.beaconBlocksByRange(nodeB.peerId, request);
    assert.deepEqual(response, []);
  });

  it("should handle response timeout - TTFB", async function () {
    this.timeout(400);
    const timer = sinon.useFakeTimers({shouldAdvanceTime: true});
    const request: BeaconBlocksByRangeRequest = {
      startSlot: 100,
      count: 10,
      step: 1,
    };
    rpcB.once("request", async () => {
      timer.tick(TTFB_TIMEOUT);
      timer.tick(TTFB_TIMEOUT);
    });
    try {
      await rpcA.beaconBlocksByRange(nodeB.peerId, request);
      expect.fail();
    } catch (e) {
      expect(e.toString().startsWith("Error: response timeout")).to.be.true;
    }
    timer.restore();
  });

  it("should handle response timeout - suspended dialProtocol", async function () {
    const timer = sinon.useFakeTimers();
    const request: BeaconBlocksByRangeRequest = {
      startSlot: 100,
      count: 10,
      step: 1,
    };
    const libP2pMock = await createNode(multiaddr);
    libP2pMock.dialProtocol = async () => {
      timer.tick(TTFB_TIMEOUT);
      return null!;
    };
    const rpcC = new ReqResp(networkOptions, {
      config,
      libp2p: libP2pMock,
      logger: logger,
      blockProviderScores: blockProviderScoresStub,
      peerMetadata: sinon.createStubInstance(Libp2pPeerMetadataStore),
    });
    try {
      await rpcC.beaconBlocksByRange(nodeB.peerId, request);
      expect.fail();
    } catch (e) {
      expect(e.toString().startsWith("Error: Failed to dial")).to.be.true;
    }
    timer.restore();
  });
});
 */
