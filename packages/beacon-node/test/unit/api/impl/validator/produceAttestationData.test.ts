import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {toRootHex} from "@lodestar/utils";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {PayloadEnvelopeInput} from "../../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {ZERO_HASH_HEX} from "../../../../../src/constants/index.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

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

  describe("producePayloadAttestationData", () => {
    it("Should throw before Gloas", async () => {
      await expect(api.producePayloadAttestationData({slot: 0})).rejects.toThrow(
        "producePayloadAttestationData is not supported before Gloas"
      );
    });

    it("Should produce payload attestation data for the canonical block", async () => {
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

      modules.forkChoice.getCanonicalBlockClosestLteSlot.mockReturnValue({
        slot: 0,
        blockRoot: ZERO_HASH_HEX,
      } as ProtoBlock);
      vi.mocked(modules.chain.seenPayloadEnvelopeInputCache.get).mockReturnValue({
        hasPayloadEnvelope: () => true,
        hasAllData: () => true,
      } as PayloadEnvelopeInput);

      const res = await api.producePayloadAttestationData({slot: 0});
      if (res.data instanceof Uint8Array) {
        throw Error("Expected payload attestation data object");
      }

      expect(toRootHex(res.data.beaconBlockRoot)).toBe(ZERO_HASH_HEX);
      expect(res.data.slot).toBe(0);
      expect(res.data.payloadPresent).toBe(true);
      expect(res.data.blobDataAvailable).toBe(true);
    });
  });
});
