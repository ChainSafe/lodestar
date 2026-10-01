import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconDb} from "@lodestar/beacon-node";
import {createChainForkConfig} from "@lodestar/config";
import {Db} from "@lodestar/db";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createBeaconStateView, getValidatorCountFromStateBytes} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {initBeaconState} from "../../../src/cmds/beacon/initBeaconState.js";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {prepareCheckpointFileInitialization} from "../../../src/cmds/beacon/stateInitialization/checkpointState.js";
import {
  StateInitializationError,
  StateInitializationErrorCode,
} from "../../../src/cmds/beacon/stateInitialization/errors.js";
import {GlobalArgs} from "../../../src/options/globalOptions.js";
import {downloadOrLoadFile} from "../../../src/util/index.js";
import {getMockedLogger} from "../../utils/loggerMock.js";

vi.mock("../../../src/util/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/index.js")>()),
  downloadOrLoadFile: vi.fn(),
}));

vi.mock("@lodestar/state-transition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lodestar/state-transition")>();
  return {
    ...actual,
    createBeaconStateView: vi.fn(),
    getValidatorCountFromStateBytes: vi.fn(actual.getValidatorCountFromStateBytes),
  };
});

describe("checkpoint state pre-load validation", () => {
  const chainForkConfig = createChainForkConfig({});
  const genesisTime = 1_600_000_000;
  const state = ssz.phase0.BeaconState.defaultValue();
  state.genesisTime = genesisTime;
  state.slot = SLOTS_PER_EPOCH;
  state.validators.push({
    ...ssz.phase0.Validator.defaultValue(),
    effectiveBalance: 32_000_000_000,
    exitEpoch: Infinity,
    withdrawableEpoch: Infinity,
  });
  state.balances.push(32_000_000_000);
  const stateBytes = ssz.phase0.BeaconState.serialize(state);
  const logger = getMockedLogger();
  const controller: Db = {
    close: vi.fn(),
    setMetrics: vi.fn(),
    get: vi.fn(),
    getMany: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    batchPut: vi.fn(),
    batchDelete: vi.fn(),
    batch: vi.fn(),
    keysStream: vi.fn(),
    keys: vi.fn(),
    valuesStream: vi.fn(),
    values: vi.fn(),
    entriesStream: vi.fn(),
    entries: vi.fn(),
  };
  const db = new BeaconDb(chainForkConfig, controller, {dataColumnDir: "unused", logger});
  const context = {chainForkConfig, db, logger, dataDir: "unused"};

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(
      genesisTime * 1000 + 1_000 * SLOTS_PER_EPOCH * chainForkConfig.SLOT_DURATION_MS
    );
    vi.mocked(downloadOrLoadFile).mockResolvedValue(stateBytes);
    vi.spyOn(pubkeyCache, "ensureCapacity").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a stale checkpoint without a deserialized state", async () => {
    const stateInit = await prepareCheckpointFileInitialization("checkpoint.ssz", {}, null, context);

    expect(() => stateInit.validateBeforeLoad()).toThrow(StateInitializationError);
    expect(() => stateInit.validateBeforeLoad()).toThrow(
      expect.objectContaining({type: {code: StateInitializationErrorCode.STALE_CHECKPOINT}})
    );
    expect(createBeaconStateView).not.toHaveBeenCalled();
  });

  it("allows a stale checkpoint when the weak subjectivity check is ignored", async () => {
    const stateInit = await prepareCheckpointFileInitialization(
      "checkpoint.ssz",
      {ignoreWeakSubjectivityCheck: true},
      null,
      context
    );

    expect(() => stateInit.validateBeforeLoad()).not.toThrow();
    expect(createBeaconStateView).not.toHaveBeenCalled();
  });

  it("allows a checkpoint within the weak subjectivity period", async () => {
    vi.mocked(Date.now).mockReturnValue(genesisTime * 1000 + SLOTS_PER_EPOCH * chainForkConfig.SLOT_DURATION_MS);
    const stateInit = await prepareCheckpointFileInitialization("checkpoint.ssz", {}, null, context);

    expect(() => stateInit.validateBeforeLoad()).not.toThrow();
  });

  it("rejects a stale checkpoint before reading validators, reserving capacity, or loading the state", async () => {
    vi.spyOn(db.stateArchive, "lastKey").mockResolvedValue(null);
    const args = {checkpointState: "checkpoint.ssz"} as BeaconArgs & GlobalArgs;

    await expect(initBeaconState(args, context.dataDir, chainForkConfig, db, logger)).rejects.toMatchObject({
      type: {code: StateInitializationErrorCode.STALE_CHECKPOINT},
    });
    expect(getValidatorCountFromStateBytes).not.toHaveBeenCalled();
    expect(pubkeyCache.ensureCapacity).not.toHaveBeenCalled();
    expect(createBeaconStateView).not.toHaveBeenCalled();
  });
});
