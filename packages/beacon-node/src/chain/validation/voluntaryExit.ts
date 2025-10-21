
import {phase0} from "@lodestar/types";
import {
  GossipAction,
  VoluntaryExitError,
  VoluntaryExitErrorCode,
} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {RegenCaller} from "../regen/index.js";
import { getVoluntaryExitSignatureSet, isValidVoluntaryExit } from "@lodestar/state-transition";


/**
 * Helper to get human-readable error code name
 */
function getVoluntaryExitErrorCodeName(code: VoluntaryExitErrorCode): string {
  switch (code) {
    case VoluntaryExitErrorCode.ALREADY_EXISTS:
      return "ALREADY_EXISTS";
    case VoluntaryExitErrorCode.INVALID:
      return "INVALID";
    case VoluntaryExitErrorCode.INVALID_SIGNATURE:
      return "INVALID_SIGNATURE";
    default:
      return `UNKNOWN_CODE_${code}`;
  }
}

/**
 * Validation result that distinguishes between permanent and transient failures
 */
interface ValidationResult {
  isValid: boolean;
  error?: {
    action: GossipAction;
    code:
      | VoluntaryExitErrorCode.ALREADY_EXISTS
      | VoluntaryExitErrorCode.INACTIVE
      | VoluntaryExitErrorCode.ALREADY_EXITED
      | VoluntaryExitErrorCode.EARLY_EPOCH
      | VoluntaryExitErrorCode.SHORT_TIME_ACTIVE
      | VoluntaryExitErrorCode.PENDING_WITHDRAWALS
      | VoluntaryExitErrorCode.INVALID_SIGNATURE;
    isTransient: boolean; // True if the error might resolve over time
  };
}

/**
 * Cached voluntary exit awaiting transient conditions to be met
 */
interface CachedVoluntaryExit {
  exit: phase0.SignedVoluntaryExit;
  submittedAt: number; // Timestamp
  lastCheckedEpoch: number;
  failureReason: string;
}

/**
 * Pool for managing pending voluntary exits that failed transient checks
 */
class PendingVoluntaryExitPool {
  private pending = new Map<number, CachedVoluntaryExit>(); // validatorIndex -> exit
  private readonly MAX_CACHE_TIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  add(validatorIndex: number, exit: phase0.SignedVoluntaryExit, reason: string, epoch: number): void {
    this.pending.set(validatorIndex, {
      exit,
      submittedAt: Date.now(),
      lastCheckedEpoch: epoch,
      failureReason: reason,
    });
  }

  get(validatorIndex: number): CachedVoluntaryExit | undefined {
    return this.pending.get(validatorIndex);
  }

  delete(validatorIndex: number): void {
    this.pending.delete(validatorIndex);
  }

  /**
   * Clean up stale cached exits
   */
  prune(): void {
    const now = Date.now();
    for (const [validatorIndex, cached] of this.pending.entries()) {
      if (now - cached.submittedAt > this.MAX_CACHE_TIME_MS) {
        this.pending.delete(validatorIndex);
      }
    }
  }

  getAllPending(): Map<number, CachedVoluntaryExit> {
    return new Map(this.pending);
  }

  size(): number {
    return this.pending.size;
  }
}

/**
 * Validates a voluntary exit with detailed error classification
 */
async function validateVoluntaryExitDetailed(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit,
  prioritizeBls = false
): Promise<ValidationResult> {
  const validatorIndex = voluntaryExit.message.validatorIndex;

  // Check if already seen (this is always permanent)
  if (chain.opPool.hasSeenVoluntaryExit(validatorIndex)) {
    return {
      isValid: false,
      error: {
        action: GossipAction.IGNORE,
        code: VoluntaryExitErrorCode.ALREADY_EXISTS,
        isTransient: false,
      },
    };
  }

  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipVoluntaryExit);

  // First verify signature (permanent failure if invalid)
  const signatureSet = getVoluntaryExitSignatureSet(state, voluntaryExit);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    return {
      isValid: false,
      error: {
        action: GossipAction.REJECT,
        code: VoluntaryExitErrorCode.INVALID_SIGNATURE,
        isTransient: false,
      },
    };
  }

  if (!isValidVoluntaryExit(chain.config.getForkSeq(state.slot), state, voluntaryExit, false)) {
    // Determine if the failure is transient and map to a specific VoluntaryExitErrorCode
    const validator = state.validators.get(validatorIndex);
    const isTransient =
      validator !== undefined &&
      // Validator not yet active (could become active)
      (!validator.activationEpoch ||
        // Validator has initiated exit but epoch hasn't passed (time-based)
        validator.exitEpoch !== Infinity ||
        false);

    // Map general INVALID reason to a more specific code expected by VoluntaryExitError
    let code: VoluntaryExitErrorCode;
    if (validator === undefined || !validator.activationEpoch) {
      code = VoluntaryExitErrorCode.INACTIVE;
    } else if (validator.exitEpoch !== Infinity) {
      code = VoluntaryExitErrorCode.ALREADY_EXITED;
    } else {
      // Fallback to EARLY_EPOCH for time-based invalid reasons
      code = VoluntaryExitErrorCode.EARLY_EPOCH;
    }

    return {
      isValid: false,
      error: {
        action: GossipAction.REJECT,
        code,
        isTransient,
      },
    };
  }

  return {isValid: true};
}

/**
 * API validation that accepts and caches transient failures
 */
export async function validateApiVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit,
  pendingPool?: PendingVoluntaryExitPool
): Promise<{shouldPublish: boolean; isCached: boolean}> {
  const prioritizeBls = true;
  const result = await validateVoluntaryExitDetailed(chain, voluntaryExit, prioritizeBls);

  if (result.isValid) {
    return {shouldPublish: true, isCached: false};
  }

  // If we have a transient error and a pending pool, cache it
  if (result.error?.isTransient && pendingPool) {
    const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipVoluntaryExit);
    const errorCodeName = getVoluntaryExitErrorCodeName(result.error.code);
    pendingPool.add(
      voluntaryExit.message.validatorIndex,
      voluntaryExit,
      `Transient failure: ${errorCodeName}`,
      state.epochCtx.epoch
    );
    return {shouldPublish: false, isCached: true};
  }
  //biome-ignore lint/style/noNonNullAssertion: error is guaranteed to exist when isValid is false
  throw new VoluntaryExitError(result.error!.action, {
    //biome-ignore lint/style/noNonNullAssertion: error is guaranteed to exist when isValid is false
    code: result.error!.code,
  });
}

/**
 * Gossip validation (strict, no caching)
 */
export async function validateGossipVoluntaryExit(
  chain: IBeaconChain,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<void> {
  const result = await validateVoluntaryExitDetailed(chain, voluntaryExit);

  if (!result.isValid) {
    //biome-ignore lint/style/noNonNullAssertion: error is guaranteed to exist when isValid is false
    throw new VoluntaryExitError(result.error!.action, {
      //biome-ignore lint/style/noNonNullAssertion: error is guaranteed to exist when isValid is false
      code: result.error!.code,
    });
  }
}

/**
 * Process pending voluntary exits at each epoch
 * Should be called by the beacon chain on epoch transitions
 */
export async function processPendingVoluntaryExits(
  chain: IBeaconChain,
  pendingPool: PendingVoluntaryExitPool,
  network: {publishVoluntaryExit(exit: phase0.SignedVoluntaryExit): Promise<void>}
): Promise<void> {
  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipVoluntaryExit);
  const currentEpoch = state.epochCtx.epoch;

  const toRemove: number[] = [];

  for (const [validatorIndex, cached] of pendingPool.getAllPending()) {
    if (cached.lastCheckedEpoch === currentEpoch) {
      continue;
    }

    try {
      const result = await validateVoluntaryExitDetailed(chain, cached.exit);

      if (result.isValid) {
        chain.opPool.insertVoluntaryExit(cached.exit);
        await network.publishVoluntaryExit(cached.exit);
        toRemove.push(validatorIndex);
      } else if (!result.error?.isTransient) {
        toRemove.push(validatorIndex);
      }
    } catch {
      toRemove.push(validatorIndex);
    }
  }

  // Remove processed exits
  for (const validatorIndex of toRemove) {
    pendingPool.delete(validatorIndex);
  }

  // Clean up old entries
  pendingPool.prune();
}

export {PendingVoluntaryExitPool};
