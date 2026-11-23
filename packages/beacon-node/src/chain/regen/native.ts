import {BeaconConfig} from "@lodestar/config";
import {IForkChoice, NativeForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {SeenBlock} from "@lodestar/native/regen";
import {IBeaconStateView, computeEpochAtSlot} from "@lodestar/state-transition";
import {BeaconBlock, RootHex, Slot} from "@lodestar/types";
import {LodestarError, Logger, fromHex, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {ChainEventEmitter} from "../emitter.js";
import {NativeBlockStateCache} from "../stateCache/nativeBlockStateCache.js";
import {NativeCheckpointStateCache} from "../stateCache/nativeCheckpointStateCache.js";
import {nativeErrorCode} from "../stateCache/nativeStateCacheUtils.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {RegenError, RegenErrorCode} from "./errors.js";
import {IStateRegeneratorInternal, RegenCaller, StateRegenerationOpts} from "./interface.js";
import {NativeRegenerator} from "./nativeRegenerator.js";
import {processSlotsByCheckpoint} from "./regen.js";

type NativeRegenModules = {
  config: BeaconConfig;
  forkChoice: IForkChoice;
  blockStateCache: NativeBlockStateCache;
  checkpointStateCache: NativeCheckpointStateCache;
  metrics: Metrics | null;
  validatorMonitor: ValidatorMonitor | null;
  logger: Logger;
  emitter: ChainEventEmitter;
  signal: AbortSignal;
};

/** Keeps the TS epoch loop for checkpoint publication, maintenance and event-loop yields. */
export class NativeStateRegenerator implements IStateRegeneratorInternal {
  private readonly seenBlock: SeenBlock;
  private readonly nativeRegen: NativeRegenerator;
  private readonly signal: AbortSignal;
  private closed = false;

  constructor(private readonly modules: NativeRegenModules) {
    this.signal = modules.signal;
    this.assertOpen();
    if (!(modules.forkChoice instanceof NativeForkChoice)) {
      throw new LodestarError({code: "NATIVE_REGEN_REQUIRES_NATIVE_FORK_CHOICE"});
    }
    this.seenBlock = new SeenBlock(
      256,
      Math.max(64 * 1024 * 1024, modules.config.MAX_PAYLOAD_SIZE),
      modules.config.MAX_PAYLOAD_SIZE
    );
    try {
      this.nativeRegen = new NativeRegenerator(
        modules.config,
        modules.blockStateCache.binding,
        modules.checkpointStateCache.binding,
        this.seenBlock,
        modules.forkChoice.store
      );
    } catch (error) {
      this.seenBlock.release();
      throw error;
    }
    this.signal.addEventListener("abort", this.onAbort, {once: true});
  }

  private readonly onAbort = (): void => this.close();

  addBlock(root: Uint8Array, bytes: Uint8Array): void {
    this.assertOpen();
    this.seenBlock.add(root, bytes);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.onAbort);
    this.nativeRegen.release();
    this.seenBlock.release();
  }

  private assertOpen(): void {
    if (this.closed || this.signal.aborted) throw new LodestarError({code: "NATIVE_REGEN_CLOSED"});
    this.modules.blockStateCache.assertOpen();
    this.modules.checkpointStateCache.assertOpen();
  }

  async getPreState(block: BeaconBlock, opts: StateRegenerationOpts, caller: RegenCaller): Promise<IBeaconStateView> {
    const parent = this.modules.forkChoice.getBlockHexDefaultStatus(toRootHex(block.parentRoot));
    if (!parent) {
      throw new RegenError({code: RegenErrorCode.BLOCK_NOT_IN_FORKCHOICE, blockRoot: block.parentRoot});
    }
    if (computeEpochAtSlot(parent.slot) < computeEpochAtSlot(block.slot)) {
      return this.getBlockSlotState(parent, block.slot, opts, caller, true);
    }
    return this.getState(parent.stateRoot, caller, true);
  }

  async getBlockSlotState(
    block: ProtoBlock,
    slot: Slot,
    opts: StateRegenerationOpts,
    caller: RegenCaller,
    allowDiskReload = false
  ): Promise<IBeaconStateView> {
    if (slot < block.slot) {
      throw new RegenError({code: RegenErrorCode.SLOT_BEFORE_BLOCK_SLOT, slot, blockSlot: block.slot});
    }
    const epoch = computeEpochAtSlot(slot);
    const checkpointState = allowDiskReload
      ? await this.modules.checkpointStateCache.getOrReloadLatest(block.blockRoot, epoch)
      : this.modules.checkpointStateCache.getLatest(block.blockRoot, epoch);
    const state = checkpointState ?? (await this.getState(block.stateRoot, caller, allowDiskReload));
    return processSlotsByCheckpoint(this.modules, state, slot, caller, opts);
  }

  async getState(stateRoot: RootHex, _caller: RegenCaller, allowDiskReload = false): Promise<IBeaconStateView> {
    const cachedState = this.modules.blockStateCache.get(stateRoot);
    if (cachedState) return cachedState;
    this.assertOpen();
    let state: IBeaconStateView | undefined;
    try {
      state = this.nativeRegen.getState(fromHex(stateRoot), allowDiskReload);
      return state;
    } catch (error) {
      switch (nativeErrorCode(error)) {
        case "StateNotInForkChoice":
        case "BlockNotInForkChoice":
          throw new RegenError({code: RegenErrorCode.STATE_NOT_IN_FORKCHOICE, stateRoot});
        case "NoSeedState":
          throw new RegenError({code: RegenErrorCode.NO_SEED_STATE});
        case "TooManyBlocksProcessed":
          throw new RegenError({code: RegenErrorCode.TOO_MANY_BLOCK_PROCESSED, stateRoot});
        case "BlockNotInCache":
          throw new RegenError({code: RegenErrorCode.BLOCK_NOT_IN_CACHE, stateRoot});
        case "InvalidStateRoot":
          if (
            error instanceof Error &&
            "slot" in error &&
            typeof error.slot === "number" &&
            "expected" in error &&
            error.expected instanceof Uint8Array &&
            "actual" in error &&
            error.actual instanceof Uint8Array
          ) {
            throw new RegenError({
              code: RegenErrorCode.INVALID_STATE_ROOT,
              slot: error.slot,
              expected: toRootHex(error.expected),
              actual: toRootHex(error.actual),
            });
          }
          throw error;
        case "StateTransitionError":
          throw new RegenError({code: RegenErrorCode.STATE_TRANSITION_ERROR, error: error as Error});
        default:
          throw error;
      }
    } finally {
      if (allowDiskReload) {
        // Native replay can admit/evict blocks and reload checkpoint seeds even if replay fails.
        this.modules.blockStateCache.syncCache(state);
        this.modules.checkpointStateCache.syncCache();
      }
    }
  }
}
