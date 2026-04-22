import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {BlockType} from "../../../../../src/chain/produceBlock/produceBlockBody.js";
import {SyncState} from "../../../../../src/sync/interface.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

describe("api/validator - getExecutionPayloadEnvelope", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getValidatorApi>;

  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 1,
    FULU_FORK_EPOCH: 1,
    GLOAS_FORK_EPOCH: 2,
  });
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  beforeEach(() => {
    modules = getApiTestModules({config});
    api = getValidatorApi(defaultApiOptions, {...modules, config});
  });

  it("returns the cached Gloas stateRoot for self-build envelopes", async () => {
    const slot = 2 * SLOTS_PER_EPOCH;
    const beaconBlockRoot = Buffer.alloc(32, 0x11);
    const executionPayload = {
      ...ssz.gloas.ExecutionPayload.defaultValue(),
      blockHash: Buffer.alloc(32, 0x22),
    };
    const executionRequests = ssz.electra.ExecutionRequests.defaultValue();
    const stateRoot = Buffer.alloc(32, 0x33);

    vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(slot);
    vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
    modules.chain.blockProductionCache = {get: vi.fn()} as never;
    modules.chain.blockProductionCache.get.mockReturnValue({
      fork: ForkName.gloas,
      type: BlockType.Full,
      executionPayload,
      executionRequests,
      stateRoot,
    } as never);

    const {data, meta} = await api.getExecutionPayloadEnvelope({slot, beaconBlockRoot});

    expect(meta.version).toBe(ForkName.gloas);
    expect(toRootHex(data.beaconBlockRoot)).toBe(toRootHex(beaconBlockRoot));
    expect(toRootHex(data.payload.blockHash)).toBe(toRootHex(executionPayload.blockHash));
    expect(data.executionRequests).toEqual(executionRequests);
    expect(toRootHex(data.stateRoot)).toBe(toRootHex(stateRoot));
  });
});
