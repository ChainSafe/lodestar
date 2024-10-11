import {describe, it, expect, afterEach, beforeEach, vi} from "vitest";
import {createChainForkConfig, ChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {RequestError, RequestErrorCode, ResponseOutgoing} from "@lodestar/reqresp";
import {altair, phase0, Root, SignedBeaconBlock, ssz} from "@lodestar/types";
import {sleep as _sleep} from "@lodestar/utils";
import {Network, ReqRespBeaconNodeOpts} from "../../../src/network/index.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {connect, getPeerIdOf, onPeerConnect} from "../../utils/network.js";
import {getNetworkForTest} from "../../utils/networkWithMockDb.js";
import {arrToSource} from "../../unit/network/reqresp/utils.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../../../src/network/reqresp/types.js";
import {PeerIdStr} from "../../../src/util/peerId.js";

/* eslint-disable require-yield, @typescript-eslint/naming-convention */

describe("network / reqresp / main thread", function () {
  vi.setConfig({testTimeout: 3000});

  runTests({useWorker: false});
});

describe("network / reqresp / worker", function () {
  vi.setConfig({testTimeout: 30_000});

  runTests({useWorker: true});
});

function runTests({useWorker}: {useWorker: boolean}): void {
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
  beforeEach(() => {
    controller = new AbortController();
  });
  afterEach(() => controller.abort());
  async function sleep(ms: number): Promise<void> {
    await _sleep(ms, controller.signal);
  }

  async function createAndConnectPeers(
    getReqRespHandler?: GetReqRespHandlerFn,
    opts?: ReqRespBeaconNodeOpts
  ): Promise<[Network, Network, PeerIdStr, PeerIdStr]> {
    const [netA, closeA] = await getNetworkForTest(`reqresp-${useWorker ? "worker" : "main"}-A`, config, {
      getReqRespHandler,
      opts: {...opts, useWorker},
    });
    const [netB, closeB] = await getNetworkForTest(`reqresp-${useWorker ? "worker" : "main"}-B`, config, {
      getReqRespHandler,
      opts: {...opts, useWorker},
    });

    afterEachCallbacks.push(async () => {
      await closeA();
      await closeB();
    });

    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB);
    await connected;

    return [netA, netB, await getPeerIdOf(netA), await getPeerIdOf(netB)];
  }

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
    expect(returnedBlocks).toHaveLength(req.count);

    for (const [i, returnedBlock] of returnedBlocks.entries()) {
      expect(ssz.phase0.SignedBeaconBlock.equals(returnedBlock.data, blocks[i])).toBe(true);
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
    expect(ssz.altair.LightClientBootstrap.toJson(returnedValue)).toEqual(
      ssz.altair.LightClientBootstrap.toJson(expectedValue)
    );
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
    expect(ssz.altair.LightClientOptimisticUpdate.toJson(returnedValue)).toEqual(
      ssz.altair.LightClientOptimisticUpdate.toJson(expectedValue)
    );
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
    expect(ssz.altair.LightClientFinalityUpdate.toJson(returnedValue)).toEqual(
      ssz.altair.LightClientFinalityUpdate.toJson(expectedValue)
    );
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
    expect(returnedUpdates).toHaveLength(2);

    for (const [i, returnedUpdate] of returnedUpdates.entries()) {
      expect(ssz.altair.LightClientUpdate.serialize(returnedUpdate)).toEqual(lightClientUpdates[i].data);
    }
  });

  it("should handle a server error", async function () {
    const testErrorMessage = "TEST_EXAMPLE_ERROR_1234";
    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        // biome-ignore lint/correctness/useYield: No need for yield in test context
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
        // biome-ignore lint/correctness/useYield: No need for yield in test context
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

function wrapBlockAsEncodedPayload(config: ChainForkConfig, block: SignedBeaconBlock): ResponseOutgoing {
  return {
    data: config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block),
    fork: config.getForkName(block.message.slot),
  };
}
