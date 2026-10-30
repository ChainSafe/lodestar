import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";
import {IBeaconStateView} from "@lodestar/state-transition";
import {fromHex, toRootHex} from "@lodestar/utils";
import {NodeIsSyncing} from "../../../../../src/api/impl/errors.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {ZERO_HASH_HEX} from "../../../../../src/constants/index.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {withBeaconEngineFacade} from "../../../../mocks/mockedBeaconChain.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";

describe("api - validator - produceAttestationData", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  beforeEach(() => {
    modules = getApiTestModules();
    api = getValidatorApi(defaultApiOptions, modules);
  });

  it("Should throw when node is not synced", async () => {
    // Set the node's state to way back from current slot
    const currentSlot = 100000;
    const headSlot = 0;
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.SyncingFinalized);
    modules.forkChoice.getHead.mockReturnValue({slot: headSlot} as ProtoBlock);

    await expect(api.produceAttestationData({committeeIndex: 0, slot: 0})).rejects.toThrow("Node is syncing");
  });

  it("Should throw error when node is stopped", async () => {
    const currentSlot = 100000;
    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Stalled);

    // Should not allow any call to validator API
    await expect(api.produceAttestationData({committeeIndex: 0, slot: 0})).rejects.toThrow(
      "Node is syncing - waiting for peers"
    );
  });

  it("produces attestation data from Core when the local view is stale", async () => {
    const head = generateProtoBlock({
      blockRoot: toRootHex(Buffer.alloc(32, 4)),
      executionStatus: ExecutionStatus.Valid,
    });
    const source = {epoch: 0, root: new Uint8Array(32).fill(5)};
    modules.forkChoice.getHead.mockReturnValue(head);
    modules.forkChoice.getBlockDefaultStatus.mockReturnValue(head);
    vi.mocked(modules.chain.beaconEngine.getHeadState).mockReturnValue({
      slot: 0,
      currentJustifiedCheckpoint: source,
    } as IBeaconStateView);
    vi.spyOn(modules.chain.beaconEngine.chainView, "getHead").mockImplementation(() => {
      throw Error("Stale ChainView head");
    });
    vi.spyOn(modules.chain.beaconEngine.chainView, "getBlockDefaultStatus").mockImplementation(() => {
      throw Error("Stale ChainView block");
    });

    const response = await api.produceAttestationData({slot: 0, committeeIndex: 2});
    expect(response.data).toEqual({
      slot: 0,
      index: 2,
      beaconBlockRoot: fromHex(head.blockRoot),
      source,
      target: {epoch: 0, root: fromHex(head.blockRoot)},
    });
  });

  it("rejects an optimistic contribution using Core despite a locally known block", async () => {
    const head = generateProtoBlock({executionStatus: ExecutionStatus.Syncing});
    modules.forkChoice.hasBlock.mockReturnValue(true);
    modules.forkChoice.getBlockDefaultStatus.mockReturnValue(head);
    vi.spyOn(modules.chain.beaconEngine.chainView, "getBlockDefaultStatus").mockReturnValue(
      generateProtoBlock({executionStatus: ExecutionStatus.Valid})
    );
    api = getValidatorApi(defaultApiOptions, {...modules, chain: withBeaconEngineFacade(modules.chain)});

    await expect(
      api.produceSyncCommitteeContribution({slot: 0, subcommitteeIndex: 0, beaconBlockRoot: fromHex(head.blockRoot)})
    ).rejects.toBeInstanceOf(NodeIsSyncing);
  });

  describe("producePayloadAttestationData", () => {
    it("Should throw before Gloas", async () => {
      await expect(api.producePayloadAttestationData({slot: 0})).rejects.toThrow(
        "producePayloadAttestationData is not supported before Gloas"
      );
    });

    it.each([
      [-0.001, true],
      [0, false],
      [0.001, false],
    ] as const)("uses Core's canonical block and the envelope deadline offset %s", async (offset, expectedPresent) => {
      const gloasConfig = createChainForkConfig({
        ...defaultChainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
      });
      modules = getApiTestModules({config: gloasConfig});
      modules.config = gloasConfig;
      api = getValidatorApi(defaultApiOptions, modules);

      modules.forkChoice.getCanonicalBlockAtSlot.mockReturnValue({
        slot: 0,
        blockRoot: ZERO_HASH_HEX,
      } as ProtoBlock);
      vi.spyOn(modules.chain.beaconEngine.chainView, "getCanonicalProtoBlockAtSlot").mockImplementation(() => {
        throw Error("Stale ChainView canonical block");
      });
      vi.mocked(modules.chain.clock.secFromSlot).mockReturnValue(
        gloasConfig.getPayloadDueMs(gloasConfig.getForkName(0)) / 1000 + offset
      );
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue({
        hasPayloadEnvelope: () => true,
        getPayloadEnvelopeSource: () => ({source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0}),
        hasAllData: () => true,
      } as PayloadEnvelopeInput);

      const res = await api.producePayloadAttestationData({slot: 0});
      if (res.data === undefined || res.data instanceof Uint8Array) {
        throw Error("Expected payload attestation data object");
      }

      expect(toRootHex(res.data.beaconBlockRoot)).toBe(ZERO_HASH_HEX);
      expect(res.data.slot).toBe(0);
      expect(res.data.payloadPresent).toBe(expectedPresent);
      expect(modules.chain.seenPayloadEnvelopeInputCache.get).toHaveBeenCalledWith(ZERO_HASH_HEX);
      expect(res.data.blobDataAvailable).toBe(true);
    });

    it("Should return no data when no canonical block has been seen for the assigned slot", async () => {
      const gloasConfig = createChainForkConfig({
        ...defaultChainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
      });
      modules = getApiTestModules({config: gloasConfig});
      modules.config = gloasConfig;
      api = getValidatorApi(defaultApiOptions, modules);

      modules.forkChoice.getCanonicalBlockAtSlot.mockReturnValue(null);

      const res = await api.producePayloadAttestationData({slot: 1});
      expect(res.data).toBeUndefined();
    });
  });
});
