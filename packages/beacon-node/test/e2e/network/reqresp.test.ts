import {expect} from "chai";
import {createChainForkConfig, ChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {RequestError, RequestErrorCode, ResponseOutgoing} from "@lodestar/reqresp";
import {allForks, altair, phase0, Root, ssz} from "@lodestar/types";
import {sleep as _sleep} from "@lodestar/utils";
import {Network, ReqRespBeaconNodeOpts} from "../../../src/network/index.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {connect, getNetworkForTest, getPeerIdOf, onPeerConnect} from "../../utils/network.js";
import {arrToSource} from "../../unit/network/reqresp/utils.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../../../src/network/reqresp/types.js";
import {PeerIdStr} from "../../../src/util/peerId.js";

/* eslint-disable
    mocha/no-top-level-hooks,
    require-yield,
    @typescript-eslint/naming-convention,
    @typescript-eslint/explicit-function-return-type
*/

describe("network / reqresp / main thread", function () {
  runTests.bind(this)({useWorker: false});
});

describe("network / reqresp / worker", function () {
  runTests.bind(this)({useWorker: true});
});

function runTests(this: Mocha.Suite, {useWorker}: {useWorker: boolean}): void {
  if (this.timeout() < 60_000) this.timeout(60_000);
  this.retries(2); // This test fail sometimes, with a 5% rate.

  // Schedule ALTAIR_FORK_EPOCH to trigger registering lightclient ReqResp protocols immediately
  const config = createChainForkConfig({
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
  });

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());
  async function sleep(ms: number): Promise<void> {
    await _sleep(ms, controller.signal);
  }

  async function createAndConnectPeers(
    getReqRespHandler?: GetReqRespHandlerFn,
    opts?: ReqRespBeaconNodeOpts
  ): Promise<[Network, Network, PeerIdStr, PeerIdStr]> {
    const [netA, closeA] = await getNetworkForTest("A", config, {getReqRespHandler, opts: {...opts, useWorker}});
    const [netB, closeB] = await getNetworkForTest("B", config, {getReqRespHandler, opts: {...opts, useWorker}});

    afterEachCallbacks.push(async () => {
      await closeA();
      await closeB();
    });

    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB);
    await connected;

    return [netA, netB, await getPeerIdOf(netA), await getPeerIdOf(netB)];
  }

  // it("should send/receive a ping message", async function () {
  //   const [netA, netB] = await createAndConnectPeers();

  //   // Modify the metadata to make the seqNumber non-zero
  //   netB.metadata.attnets = BitArray.fromBitLen(0);
  //   netB.metadata.attnets = BitArray.fromBitLen(0);
  //   const expectedPong = netB.metadata.seqNumber;
  //   expect(expectedPong.toString()).to.deep.equal("2", "seqNumber");

  //   const pong = await netA.reqResp.ping(peerIdB);
  //   expect(pong.toString()).to.deep.equal(expectedPong.toString(), "Wrong response body");
  // });

  // it("should send/receive a metadata message - altair", async function () {
  //   const [netA, netB] = await createAndConnectPeers();

  //   const metadata: altair.Metadata = {
  //     seqNumber: netB.metadata.seqNumber,
  //     attnets: netB.metadata.attnets,
  //     syncnets: netB.metadata.syncnets,
  //   };

  //   const receivedMetadata = await netA.reqResp.metadata(peerIdB);
  //   expect(receivedMetadata).to.deep.equal(metadata, "Wrong response body");
  // });

  // it("should send/receive a status message", async function () {
  //   const status: phase0.Status = {
  //     forkDigest: Buffer.alloc(4, 0),
  //     finalizedRoot: Buffer.alloc(32, 0),
  //     finalizedEpoch: 0,
  //     headRoot: Buffer.alloc(32, 0),
  //     headSlot: 0,
  //   };
  //   const statusNetA: phase0.Status = {...status, finalizedEpoch: 1};
  //   const statusNetB: phase0.Status = {...status, finalizedEpoch: 2};

  //   const [netA, netB] = await createAndConnectPeers({
  //     onStatus: async function* onRequest() {
  //       yield {data: ssz.phase0.Status.serialize(statusNetB), fork: ForkName.phase0};
  //     },
  //   });

  //   const receivedStatus = await netA.reqResp.status(peerIdB, statusNetA);
  //   expect(receivedStatus).to.deep.equal(statusNetB, "Wrong response body");
  // });

  it("should send/receive signed blocks", async function () {
    const req: phase0.BeaconBlocksByRangeRequest = {startSlot: 0, step: 1, count: 2};
    const blocks: phase0.SignedBeaconBlock[] = [];
    for (let slot = req.startSlot; slot < req.count; slot++) {
      const block = config.getForkTypes(slot).SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      blocks.push(block);
    }

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* () {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            for (const block of blocks) {
              yield wrapBlockAsEncodedPayload(config, block);
            }
          }
        }
    );

    const returnedBlocks = await netA.sendBeaconBlocksByRange(peerIdB, req);

    if (returnedBlocks === null) throw Error("Returned null");
    expect(returnedBlocks).to.have.length(req.count, "Wrong returnedBlocks length");

    for (const [i, returnedBlock] of returnedBlocks.entries()) {
      expect(ssz.phase0.SignedBeaconBlock.equals(returnedBlock.data, blocks[i])).to.equal(
        true,
        `Wrong returnedBlock[${i}]`
      );
    }
  });

  it("should send/receive a light client bootstrap message", async function () {
    const root: Root = ssz.phase0.BeaconBlockHeader.defaultValue().bodyRoot;
    const expectedValue = ssz.altair.LightClientBootstrap.defaultValue();

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.LightClientBootstrap) {
            yield {
              data: ssz.altair.LightClientBootstrap.serialize(expectedValue),
              fork: ForkName.altair,
            };
          }
        }
    );

    const returnedValue = await netA.sendLightClientBootstrap(peerIdB, root);
    expect(returnedValue).to.deep.equal(expectedValue, "Wrong response body");
  });

  it("should send/receive a light client optimistic update message", async function () {
    const expectedValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.LightClientOptimisticUpdate) {
            yield {
              data: ssz.altair.LightClientOptimisticUpdate.serialize(expectedValue),
              fork: ForkName.altair,
            };
          }
        }
    );

    const returnedValue = await netA.sendLightClientOptimisticUpdate(peerIdB);
    expect(returnedValue).to.deep.equal(expectedValue, "Wrong response body");
  });

  it("should send/receive a light client finality update message", async function () {
    const expectedValue = ssz.altair.LightClientFinalityUpdate.defaultValue();

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.LightClientFinalityUpdate) {
            yield {
              data: ssz.altair.LightClientFinalityUpdate.serialize(expectedValue),
              fork: ForkName.altair,
            };
          }
        }
    );

    const returnedValue = await netA.sendLightClientFinalityUpdate(peerIdB);
    expect(returnedValue).to.deep.equal(expectedValue, "Wrong response body");
  });

  it("should send/receive a light client update message", async function () {
    const req: altair.LightClientUpdatesByRange = {startPeriod: 0, count: 2};
    const lightClientUpdates: ResponseOutgoing[] = [];
    for (let slot = req.startPeriod; slot < req.count; slot++) {
      const update = ssz.altair.LightClientUpdate.defaultValue();
      update.signatureSlot = slot;
      lightClientUpdates.push({
        data: ssz.altair.LightClientUpdate.serialize(update),
        fork: ForkName.altair,
      });
    }

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.LightClientUpdatesByRange) {
            yield* arrToSource(lightClientUpdates);
          }
        }
    );

    const returnedUpdates = await netA.sendLightClientUpdatesByRange(peerIdB, req);

    if (returnedUpdates === null) throw Error("Returned null");
    expect(returnedUpdates).to.have.length(2, "Wrong returnedUpdates length");

    for (const [i, returnedUpdate] of returnedUpdates.entries()) {
      expect(ssz.altair.LightClientUpdate.serialize(returnedUpdate)).deep.equals(
        lightClientUpdates[i].data,
        `Wrong returnedUpdate[${i}]`
      );
    }
  });

  it("should handle a server error", async function () {
    const testErrorMessage = "TEST_EXAMPLE_ERROR_1234";
    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            throw Error(testErrorMessage);
          }
        }
    );

    await expectRejectedWithLodestarError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 3}),
      new RequestError({code: RequestErrorCode.SERVER_ERROR, errorMessage: "sNaPpYa" + testErrorMessage})
    );
  });

  it("should handle a server error after emitting two blocks", async function () {
    const testErrorMessage = "TEST_EXAMPLE_ERROR_1234";

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            for (let slot = 0; slot < 2; slot++) {
              const block = config.getForkTypes(slot).SignedBeaconBlock.defaultValue();
              block.message.slot = slot;
              yield wrapBlockAsEncodedPayload(config, block);
            }
            throw Error(testErrorMessage);
          }
        }
    );

    await expectRejectedWithLodestarError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 3}),
      new RequestError({code: RequestErrorCode.SERVER_ERROR, errorMessage: "sNaPpYa" + testErrorMessage})
    );
  });

  it("trigger a TTFB_TIMEOUT error", async function () {
    const ttfbTimeoutMs = 250;

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            // Wait for too long before sending first response chunk
            await sleep(ttfbTimeoutMs * 10);
            yield wrapBlockAsEncodedPayload(config, config.getForkTypes(0).SignedBeaconBlock.defaultValue());
          }
        },
      {ttfbTimeoutMs}
    );

    await expectRejectedWithLodestarError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 1}),
      new RequestError({code: RequestErrorCode.TTFB_TIMEOUT})
    );
  });

  it("trigger a RESP_TIMEOUT error", async function () {
    const respTimeoutMs = 250;

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            yield getEmptyEncodedPayloadSignedBeaconBlock(config);
            // Wait for too long before sending second response chunk
            await sleep(respTimeoutMs * 5);
            yield getEmptyEncodedPayloadSignedBeaconBlock(config);
          }
        },
      {respTimeoutMs}
    );

    await expectRejectedWithLodestarError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 2}),
      new RequestError({code: RequestErrorCode.RESP_TIMEOUT})
    );
  });

  it("Sleep infinite on first byte", async function () {
    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            await sleep(100000000);
          }
        },
      {respTimeoutMs: 250, ttfbTimeoutMs: 250}
    );

    await expectRejectedWithLodestarError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 2}),
      new RequestError({code: RequestErrorCode.TTFB_TIMEOUT})
    );
  });

  it("Sleep infinite on second response chunk", async function () {
    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            yield getEmptyEncodedPayloadSignedBeaconBlock(config);
            await sleep(100000000);
          }
        },
      {respTimeoutMs: 250, ttfbTimeoutMs: 250}
    );

    await expectRejectedWithLodestarError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 2}),
      new RequestError({code: RequestErrorCode.RESP_TIMEOUT})
    );
  });
}

function getEmptyEncodedPayloadSignedBeaconBlock(config: ChainForkConfig): ResponseOutgoing {
  return wrapBlockAsEncodedPayload(config, config.getForkTypes(0).SignedBeaconBlock.defaultValue());
}

function wrapBlockAsEncodedPayload(config: ChainForkConfig, block: allForks.SignedBeaconBlock): ResponseOutgoing {
  return {
    data: config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block),
    fork: config.getForkName(block.message.slot),
  };
}
