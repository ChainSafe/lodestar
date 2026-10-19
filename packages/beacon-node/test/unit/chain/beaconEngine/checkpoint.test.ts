import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {IBeaconStateView} from "@lodestar/state-transition";
import {toRootHex} from "@lodestar/utils";
import {FrequencyStateArchiveStrategy} from "../../../../src/chain/archiveStore/strategies/frequencyStateArchiveStrategy.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEvent} from "../../../../src/chain/beaconEngine/events.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
import {initDevState} from "../../../../src/node/utils/state.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";
import {createTestBeaconEngine} from "../../../utils/engine.js";

describe("BeaconEngineCore checkpoint maintenance", () => {
  const config = createChainForkConfig(chainConfig);
  const logger = getMockedLogger();
  const checkpoint = {epoch: 1, root: Buffer.alloc(32, 1)};
  let engine: BeaconEngineCore;
  let state: IBeaconStateView;
  let abortController: AbortController;
  let closeDb: () => Promise<void>;

  beforeEach(async () => {
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    closeDb = close;
    const anchorState = initDevState(config, 16, {genesisTime: 0});
    anchorState.commit();
    const stateBytes = anchorState.serialize();
    ({beaconEngineCore: engine, abortController} = createTestBeaconEngine(
      {
        ...defaultChainOptions,
        blsVerifyAllMainThread: true,
        disableLightClientServer: true,
        disablePrepareNextSlot: true,
      },
      {
        privateKey: await generateKeyPair("secp256k1"),
        config: createBeaconConfig(config, anchorState.genesisValidatorsRoot),
        pubkeyCache,
        db,
        dbName: "test",
        dataDir: "test",
        logger,
        clock: new ClockStopped(0),
        processShutdownCallback: () => {},
        metrics: null,
        anchorStateBytes: stateBytes,
        isAnchorStateFinalized: true,
        executionEngine: new ExecutionEngineDisabled(),
      }
    ));
    await engine.init();
    await engine.prepareAnchorState(stateBytes);
    await engine.initializeFromAnchor();
    state = engine.getHeadState();
    vi.spyOn(engine.regen, "getCheckpointStateSync").mockReturnValue(state);
    vi.spyOn(engine.regen, "onCheckpoint");
    vi.spyOn(engine.shufflingCache, "processState").mockImplementation(() => {});
    vi.spyOn(FrequencyStateArchiveStrategy.prototype, "onCheckpoint");
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    await engine.close();
    abortController.abort();
    vi.restoreAllMocks();
    await closeDb();
  });

  it.each([undefined, false, true])(
    "maintains caches synchronously and defers shuffling with disableArchiveOnCheckpoint=%s",
    async (disableArchiveOnCheckpoint) => {
      engine.opts.disableArchiveOnCheckpoint = disableArchiveOnCheckpoint;
      engine.emitter.emit(BeaconEngineEvent.checkpoint, checkpoint);

      expect(engine.regen.getCheckpointStateSync).toHaveBeenCalledExactlyOnceWith({
        epoch: checkpoint.epoch,
        rootHex: toRootHex(checkpoint.root),
      });
      expect(engine.shufflingCache.processState).not.toHaveBeenCalled();
      if (disableArchiveOnCheckpoint) {
        expect(engine.regen.onCheckpoint).not.toHaveBeenCalled();
        expect(FrequencyStateArchiveStrategy.prototype.onCheckpoint).not.toHaveBeenCalled();
      } else {
        expect(engine.regen.onCheckpoint).toHaveBeenCalledExactlyOnceWith(
          engine.forkChoice.getFinalizedCheckpoint().epoch,
          engine.forkChoice.getJustifiedCheckpoint().epoch,
          engine.forkChoice.getHead().stateRoot
        );
        expect(FrequencyStateArchiveStrategy.prototype.onCheckpoint).toHaveBeenCalledExactlyOnceWith(
          engine.forkChoice.getHead().stateRoot,
          null
        );
      }
      await vi.advanceTimersByTimeAsync(1);
      expect(engine.shufflingCache.processState).toHaveBeenCalledExactlyOnceWith(state);
    }
  );

  it("maintains caches even when the event's checkpoint state is missing", () => {
    vi.mocked(engine.regen.getCheckpointStateSync).mockReturnValue(null);
    engine.emitter.emit(BeaconEngineEvent.checkpoint, checkpoint);

    expect(engine.regen.onCheckpoint).toHaveBeenCalledOnce();
    expect(FrequencyStateArchiveStrategy.prototype.onCheckpoint).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["regen", "archive"])("contains %s failures within the engine", async (source) => {
    const error = new Error("checkpoint maintenance failed");
    if (source === "regen") {
      vi.mocked(engine.regen.onCheckpoint).mockImplementationOnce(() => {
        throw error;
      });
    } else {
      vi.mocked(FrequencyStateArchiveStrategy.prototype.onCheckpoint).mockRejectedValueOnce(error);
    }
    const listener = vi.fn();
    engine.emitter.on(BeaconEngineEvent.checkpoint, listener);

    expect(() => engine.emitter.emit(BeaconEngineEvent.checkpoint, checkpoint)).not.toThrow();
    expect(listener).toHaveBeenCalledExactlyOnceWith(checkpoint);
    await vi.advanceTimersByTimeAsync(1);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith("Error during state archive", {}, error);
    expect(engine.shufflingCache.processState).toHaveBeenCalledExactlyOnceWith(state);
  });

  it("stops checkpoint maintenance after close", async () => {
    engine.emitter.emit(BeaconEngineEvent.checkpoint, checkpoint);
    await vi.advanceTimersByTimeAsync(1);
    await engine.close();

    engine.emitter.emit(BeaconEngineEvent.checkpoint, checkpoint);
    expect(engine.regen.onCheckpoint).toHaveBeenCalledOnce();
    expect(FrequencyStateArchiveStrategy.prototype.onCheckpoint).toHaveBeenCalledOnce();
  });
});
