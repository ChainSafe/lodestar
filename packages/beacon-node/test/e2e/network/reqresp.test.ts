import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {RequestError, RequestErrorCode, RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Root, SignedBeaconBlock, altair, phase0, ssz} from "@lodestar/types";
import {sleep, toRootHex} from "@lodestar/utils";
import {Network, ReqRespBeaconNodeOpts} from "../../../src/network/index.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../../../src/network/reqresp/types.js";
import {PeerIdStr} from "../../../src/util/peerId.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {connect, getPeerIdOf, onPeerConnect} from "../../utils/network.js";
import {NetworkForTestModules, getNetworkForTest, getNetworkForTestModules} from "../../utils/networkWithMockDb.js";
import {buildDataColumnSidecarFixture} from "../../utils/partialColumns.js";
import {zeroProtoBlock} from "../../utils/state.js";

describe("network / reqresp / main thread", () => {
  vi.setConfig({testTimeout: 3000});

  runTests({useWorker: false});
});

describe("network / reqresp / worker", () => {
  vi.setConfig({testTimeout: 30_000});

  runTests({useWorker: true});
});

function runTests({useWorker}: {useWorker: boolean}): void {
  // Schedule ALTAIR_FORK_EPOCH to trigger registering lightclient ReqResp protocols immediately
  const config = createChainForkConfig({
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
  });
  const fuluConfig = createChainForkConfig({
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: Infinity,
  });
  let controller: AbortController;

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];

  beforeEach(() => {
    controller = new AbortController();
  });

  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  async function createAndConnectPeers(
    getReqRespHandler?: GetReqRespHandlerFn,
    opts?: ReqRespBeaconNodeOpts,
    networkConfig: ChainForkConfig = config
  ): Promise<[Network, Network, PeerIdStr, PeerIdStr]> {
    const [netA, closeA] = await getNetworkForTest(`reqresp-${useWorker ? "worker" : "main"}-A`, networkConfig, {
      getReqRespHandler,
      opts: {...opts, useWorker},
    });
    const [netB, closeB] = await getNetworkForTest(`reqresp-${useWorker ? "worker" : "main"}-B`, networkConfig, {
      getReqRespHandler,
      opts: {...opts, useWorker},
    });

    afterEachCallbacks.push(async () => {
      await closeA();
      await closeB();
    });
    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB, controller.signal);
    await connected;

    controller.signal.addEventListener("abort", async () => {
      await closeA();
      await closeB();
    });

    return [netA, netB, await getPeerIdOf(netA), await getPeerIdOf(netB)];
  }

  async function createAndConnectPeersWithModules(
    networkConfig: ChainForkConfig,
    getReqRespHandler?: GetReqRespHandlerFn,
    opts?: ReqRespBeaconNodeOpts
  ): Promise<{
    netA: Network;
    netB: Network;
    peerIdA: PeerIdStr;
    peerIdB: PeerIdStr;
    modulesA: NetworkForTestModules;
    modulesB: NetworkForTestModules;
  }> {
    const modulesA = await getNetworkForTestModules(`reqresp-${useWorker ? "worker" : "main"}-A`, networkConfig, {
      getReqRespHandler,
      opts: {...opts, useWorker},
    });
    const modulesB = await getNetworkForTestModules(`reqresp-${useWorker ? "worker" : "main"}-B`, networkConfig, {
      getReqRespHandler,
      opts: {...opts, useWorker},
    });

    afterEachCallbacks.push(async () => {
      await modulesA.closeAll();
      await modulesB.closeAll();
    });
    const connected = Promise.all([onPeerConnect(modulesA.network), onPeerConnect(modulesB.network)]);
    await connect(modulesA.network, modulesB.network, controller.signal);
    await connected;

    controller.signal.addEventListener("abort", async () => {
      await modulesA.closeAll();
      await modulesB.closeAll();
    });

    return {
      netA: modulesA.network,
      netB: modulesB.network,
      peerIdA: await getPeerIdOf(modulesA.network),
      peerIdB: await getPeerIdOf(modulesB.network),
      modulesA,
      modulesB,
    };
  }

  it("should send/receive signed blocks", async () => {
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
      expect(ssz.phase0.SignedBeaconBlock.equals(returnedBlock, blocks[i])).toBe(true);
    }
  });

  it("should send/receive a light client bootstrap message", async () => {
    const root: Root = ssz.phase0.BeaconBlockHeader.defaultValue().bodyRoot;
    const expectedValue = ssz.altair.LightClientBootstrap.defaultValue();

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.LightClientBootstrap) {
            yield {
              data: ssz.altair.LightClientBootstrap.serialize(expectedValue),
              boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
            };
          }
        }
    );

    const returnedValue = await netA.sendLightClientBootstrap(peerIdB, root);
    expect(ssz.altair.LightClientBootstrap.toJson(returnedValue)).toEqual(
      ssz.altair.LightClientBootstrap.toJson(expectedValue)
    );
  });

  it("should send/receive a light client optimistic update message", async () => {
    const expectedValue = ssz.altair.LightClientOptimisticUpdate.defaultValue();

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.LightClientOptimisticUpdate) {
            yield {
              data: ssz.altair.LightClientOptimisticUpdate.serialize(expectedValue),
              boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
            };
          }
        }
    );

    const returnedValue = await netA.sendLightClientOptimisticUpdate(peerIdB);
    expect(ssz.altair.LightClientOptimisticUpdate.toJson(returnedValue)).toEqual(
      ssz.altair.LightClientOptimisticUpdate.toJson(expectedValue)
    );
  });

  it("should send/receive a light client finality update message", async () => {
    const expectedValue = ssz.altair.LightClientFinalityUpdate.defaultValue();

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.LightClientFinalityUpdate) {
            yield {
              data: ssz.altair.LightClientFinalityUpdate.serialize(expectedValue),
              boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
            };
          }
        }
    );

    const returnedValue = await netA.sendLightClientFinalityUpdate(peerIdB);
    expect(ssz.altair.LightClientFinalityUpdate.toJson(returnedValue)).toEqual(
      ssz.altair.LightClientFinalityUpdate.toJson(expectedValue)
    );
  });

  it("should send/receive a light client update message", async () => {
    const req: altair.LightClientUpdatesByRange = {startPeriod: 0, count: 2};
    const lightClientUpdates: ResponseOutgoing[] = [];
    for (let slot = req.startPeriod; slot < req.count; slot++) {
      const update = ssz.altair.LightClientUpdate.defaultValue();
      update.signatureSlot = slot;
      lightClientUpdates.push({
        data: ssz.altair.LightClientUpdate.serialize(update),
        boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
      });
    }

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.LightClientUpdatesByRange) {
            yield* lightClientUpdates;
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

  it("should handle a server error", async () => {
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
      new RequestError({code: RequestErrorCode.SERVER_ERROR, errorMessage: testErrorMessage})
    );
  });

  it("should handle a server error after emitting two blocks", async () => {
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
      new RequestError({code: RequestErrorCode.SERVER_ERROR, errorMessage: testErrorMessage})
    );
  });

  it("should trigger a RESP_TIMEOUT error if first response is delayed", async () => {
    const respTimeoutMs = 250;

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            // Wait for too long before sending first response chunk
            await sleep(respTimeoutMs * 10, controller.signal);
            yield wrapBlockAsEncodedPayload(config, config.getForkTypes(0).SignedBeaconBlock.defaultValue());
          }
        },
      {respTimeoutMs}
    );

    await expectRejectedWithLodestarError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 1}),
      new RequestError({code: RequestErrorCode.RESP_TIMEOUT})
    );
  });

  it("should trigger a RESP_TIMEOUT error if later response is delayed", async () => {
    const respTimeoutMs = 300;

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            yield getEmptyEncodedPayloadSignedBeaconBlock(config);
            // Wait for too long before sending second response chunk
            await sleep(respTimeoutMs * 5, controller.signal);
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

  it("should send data column sidecars by root from the hot-column path", async () => {
    const {
      netA,
      peerIdB,
      modulesB: {chain: chainB, db: dbB},
    } = await createAndConnectPeersWithModules(fuluConfig);
    const [firstCustodyColumn, secondCustodyColumn] = chainB.custodyConfig.custodyColumns;

    if (firstCustodyColumn === undefined || secondCustodyColumn === undefined) {
      expect.fail("Expected at least two custody columns in the test network");
    }

    const slot = 2;
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(ssz.phase0.BeaconBlockHeader.defaultValue());
    const column0 = buildDataColumnSidecarFixture({
      chainConfig: fuluConfig,
      slot,
      parentRoot: blockRoot,
      proposerIndex: 0,
      columnIndex: firstCustodyColumn,
    });
    const column3 = buildDataColumnSidecarFixture({
      chainConfig: fuluConfig,
      slot,
      parentRoot: blockRoot,
      proposerIndex: 0,
      columnIndex: secondCustodyColumn,
    });
    const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(column0.signedBlockHeader.message));

    vi.spyOn(chainB.forkChoice, "getBlockHexDefaultStatus").mockReturnValue({
      ...zeroProtoBlock,
      slot,
      blockRoot: blockRootHex,
    });
    vi.spyOn(dbB.dataColumnSidecar, "getManyBinary").mockImplementation(async (_root, indices) =>
      indices.map((index) => {
        if (index === column3.index) {
          return ssz.fulu.DataColumnSidecar.serialize(column3);
        }
        if (index === column0.index) {
          return ssz.fulu.DataColumnSidecar.serialize(column0);
        }
        return undefined;
      })
    );

    const response = await netA.sendDataColumnSidecarsByRoot(peerIdB, [
      {blockRoot, columns: [column3.index, column0.index]},
    ]);

    expect(response).toHaveLength(2);
    expect(ssz.fulu.DataColumnSidecar.equals(response[0], column3)).toBe(true);
    expect(ssz.fulu.DataColumnSidecar.equals(response[1], column0)).toBe(true);
    expect(dbB.dataColumnSidecar.getManyBinary).toHaveBeenCalledOnce();
    expect(dbB.dataColumnSidecar.getManyBinary).toHaveBeenCalledWith(blockRoot, [column3.index, column0.index]);
  });

  it("should send finalized data column sidecars by range from the archive path", async () => {
    const {
      netA,
      peerIdB,
      modulesB: {chain: chainB, db: dbB},
    } = await createAndConnectPeersWithModules(fuluConfig);
    const [firstCustodyColumn, secondCustodyColumn] = chainB.custodyConfig.custodyColumns;

    if (firstCustodyColumn === undefined || secondCustodyColumn === undefined) {
      expect.fail("Expected at least two custody columns in the test network");
    }

    const slot = 4;
    const parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(ssz.phase0.BeaconBlockHeader.defaultValue());
    const column1 = buildDataColumnSidecarFixture({
      chainConfig: fuluConfig,
      slot,
      parentRoot,
      proposerIndex: 0,
      columnIndex: firstCustodyColumn,
    });
    const column2 = buildDataColumnSidecarFixture({
      chainConfig: fuluConfig,
      slot,
      parentRoot,
      proposerIndex: 0,
      columnIndex: secondCustodyColumn,
    });

    vi.spyOn(chainB.forkChoice, "getFinalizedBlock").mockReturnValue({
      ...zeroProtoBlock,
      slot: slot + 8,
    });
    vi.spyOn(dbB.dataColumnSidecarArchive, "getManyBinary").mockResolvedValue([
      ssz.fulu.DataColumnSidecar.serialize(column1),
      ssz.fulu.DataColumnSidecar.serialize(column2),
    ]);

    const response = await netA.sendDataColumnSidecarsByRange(peerIdB, {
      startSlot: slot,
      count: 1,
      columns: [firstCustodyColumn, secondCustodyColumn],
    });

    expect(response).toHaveLength(2);
    expect(ssz.fulu.DataColumnSidecar.equals(response[0], column1)).toBe(true);
    expect(ssz.fulu.DataColumnSidecar.equals(response[1], column2)).toBe(true);
    expect(dbB.dataColumnSidecarArchive.getManyBinary).toHaveBeenCalledOnce();
    expect(dbB.dataColumnSidecarArchive.getManyBinary).toHaveBeenCalledWith(slot, [
      firstCustodyColumn,
      secondCustodyColumn,
    ]);
  });

  it("should send non-finalized data column sidecars by range from the canonical head chain", async () => {
    const {
      netA,
      peerIdB,
      modulesB: {chain: chainB, db: dbB},
    } = await createAndConnectPeersWithModules(fuluConfig);
    const [firstCustodyColumn] = chainB.custodyConfig.custodyColumns;

    if (firstCustodyColumn === undefined) {
      expect.fail("Expected at least one custody column in the test network");
    }

    const slotA = 5;
    const slotB = 6;
    const parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(ssz.phase0.BeaconBlockHeader.defaultValue());
    const blockAColumn = buildDataColumnSidecarFixture({
      chainConfig: fuluConfig,
      slot: slotA,
      parentRoot,
      proposerIndex: 0,
      columnIndex: firstCustodyColumn,
    });
    const blockBColumn = buildDataColumnSidecarFixture({
      chainConfig: fuluConfig,
      slot: slotB,
      parentRoot,
      proposerIndex: 0,
      columnIndex: firstCustodyColumn,
    });
    const blockARootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockAColumn.signedBlockHeader.message));
    const blockBRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockBColumn.signedBlockHeader.message));
    const blockA = {
      ...zeroProtoBlock,
      slot: slotA,
      blockRoot: blockARootHex,
    };
    const blockB = {
      ...zeroProtoBlock,
      slot: slotB,
      blockRoot: blockBRootHex,
    };

    vi.spyOn(chainB.forkChoice, "getFinalizedBlock").mockReturnValue({
      ...zeroProtoBlock,
      slot: 0,
    });
    vi.spyOn(chainB.forkChoice, "getHead").mockReturnValue(blockB);
    vi.spyOn(chainB.forkChoice, "getAllAncestorBlocks").mockReturnValue([blockB, blockA]);
    vi.spyOn(dbB.dataColumnSidecar, "getManyBinary").mockImplementation(async (blockRoot, indices) => {
      const blockRootHex = toRootHex(blockRoot);
      const serialized =
        blockRootHex === blockARootHex
          ? ssz.fulu.DataColumnSidecar.serialize(blockAColumn)
          : blockRootHex === blockBRootHex
            ? ssz.fulu.DataColumnSidecar.serialize(blockBColumn)
            : undefined;
      return indices.map(() => serialized);
    });

    const response = await netA.sendDataColumnSidecarsByRange(peerIdB, {
      startSlot: slotA,
      count: 2,
      columns: [firstCustodyColumn],
    });

    expect(response).toHaveLength(2);
    expect(ssz.fulu.DataColumnSidecar.equals(response[0], blockAColumn)).toBe(true);
    expect(ssz.fulu.DataColumnSidecar.equals(response[1], blockBColumn)).toBe(true);
    expect(dbB.dataColumnSidecar.getManyBinary).toHaveBeenCalledTimes(2);
    expect(dbB.dataColumnSidecar.getManyBinary).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), [
      firstCustodyColumn,
    ]);
    expect(dbB.dataColumnSidecar.getManyBinary).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), [
      firstCustodyColumn,
    ]);
  });

  it("should detect a rate-limit response and back off the peer", async () => {
    // Simulates a Lighthouse/Grandine-style rate limit response (status 139)
    const rateLimitMessage = "Rate limited. There are already 2 active requests with the same protocol";

    const [netA, _, _0, peerIdB] = await createAndConnectPeers(
      (method) =>
        // biome-ignore lint/correctness/useYield: No need for yield in test context
        async function* onRequest() {
          if (method === ReqRespMethod.BeaconBlocksByRange) {
            throw new ResponseError(RespStatus.RATE_LIMITED, rateLimitMessage);
          }
        }
    );

    // First request: responder sends RATE_LIMITED → detected as RESP_RATE_LIMITED
    await expectRejectedWithRateLimitError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 1}),
      RequestErrorCode.RESP_RATE_LIMITED
    );

    // Second request: SelfRateLimiter has the peer in backoff → blocked before sending
    await expectRejectedWithRateLimitError(
      netA.sendBeaconBlocksByRange(peerIdB, {startSlot: 0, step: 1, count: 1}),
      RequestErrorCode.REQUEST_SELF_RATE_LIMITED
    );
  });
}

async function expectRejectedWithRateLimitError(promise: Promise<unknown>, code: RequestErrorCode): Promise<void> {
  try {
    const value = await promise;
    throw Error(`Expected promise to reject but returned value: \n\n\t${JSON.stringify(value, null, 2)}`);
  } catch (e) {
    expect(e).toBeInstanceOf(RequestError);
    const type = (e as RequestError).type as {code: RequestErrorCode; rateLimitedUntilMs?: number};
    expect(type.code).toBe(code);
    expect(type.rateLimitedUntilMs).toEqual(expect.any(Number));
  }
}

function getEmptyEncodedPayloadSignedBeaconBlock(config: ChainForkConfig): ResponseOutgoing {
  return wrapBlockAsEncodedPayload(config, config.getForkTypes(0).SignedBeaconBlock.defaultValue());
}

function wrapBlockAsEncodedPayload(config: ChainForkConfig, block: SignedBeaconBlock): ResponseOutgoing {
  return {
    data: config.getForkTypes(block.message.slot).SignedBeaconBlock.serialize(block),
    boundary: config.getForkBoundaryAtEpoch(computeEpochAtSlot(block.message.slot)),
  };
}
