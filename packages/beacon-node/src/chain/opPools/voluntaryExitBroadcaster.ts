import {Logger} from "@lodestar/logger";
import {phase0} from "@lodestar/types";
import {INetwork} from "../../network/interface.js";
import {VoluntaryExitError} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {validateGossipVoluntaryExit} from "../validation/voluntaryExit.js";

/**
 * Cached voluntary exit with metadata
 */
interface CachedVoluntaryExit {
  voluntaryExit: phase0.SignedVoluntaryExit;
  receivedAt: number; // timestamp when received via API
}

/**
 * Manages delayed broadcasting of voluntary exits.
 *
 * When a voluntary exit is submitted via API but doesn't yet meet transient conditions
 * (e.g., validator not active, exit epoch not reached, pending withdrawals), it's cached
 * here and periodically checked. Once conditions are met, it's broadcast to the network.
 *
 * This improves UX by accepting exits early and is more forgiving for DVT/multi-node setups.
 */
export class VoluntaryExitDelayedBroadcaster {
  private readonly cachedExits = new Map<number, CachedVoluntaryExit>(); // validatorIndex -> exit
  private readonly MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(
    private readonly chain: IBeaconChain,
    private readonly network: INetwork,
    private readonly logger: Logger
  ) {}

  /**
   * Add a voluntary exit to the cache for delayed broadcasting.
   * Called when a voluntary exit passes signature validation but doesn't yet meet
   * transient conditions (validator active status, exit epoch timing, etc.)
   */
  addToCacheForDelayedBroadcast(voluntaryExit: phase0.SignedVoluntaryExit): void {
    const validatorIndex = voluntaryExit.message.validatorIndex;

    // Don't cache if already exists
    if (this.cachedExits.has(validatorIndex)) {
      this.logger.debug("Voluntary exit already cached, skipping", {validatorIndex});
      return;
    }

    this.cachedExits.set(validatorIndex, {
      voluntaryExit,
      receivedAt: Date.now(),
    });

    this.logger.info("Voluntary exit cached for delayed broadcasting", {
      validatorIndex,
      epoch: voluntaryExit.message.epoch,
      cacheSize: this.cachedExits.size,
    });
  }

  /**
   * Check cached voluntary exits and broadcast those that now meet transient conditions.
   * Should be called periodically (e.g., every slot or every few seconds).
   */
  async checkAndBroadcastCachedExits(): Promise<void> {
    if (this.cachedExits.size === 0) {
      return;
    }

    const currentTime = Date.now();
    const exitsToRemove: number[] = [];

    for (const [validatorIndex, cached] of this.cachedExits.entries()) {
      try {
        // Check if exit has been in cache too long
        const ageMs = currentTime - cached.receivedAt;
        if (ageMs > this.MAX_CACHE_AGE_MS) {
          this.logger.warn("Removing stale voluntary exit from cache", {
            validatorIndex,
            ageMs,
            ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
          });
          exitsToRemove.push(validatorIndex);
          continue;
        }

        // Use full gossip validation to check if all conditions (including transient) are now met
        await validateGossipVoluntaryExit(this.chain, cached.voluntaryExit);

        // If validation passes, broadcast to network
        await this.network.publishVoluntaryExit(cached.voluntaryExit);

        this.logger.info("Successfully broadcasted delayed voluntary exit", {
          validatorIndex,
          epoch: cached.voluntaryExit.message.epoch,
          delayMs: ageMs,
          delaySeconds: Math.floor(ageMs / 1000),
        });

        // Remove from cache after successful broadcast
        exitsToRemove.push(validatorIndex);
      } catch (e) {
        if (e instanceof VoluntaryExitError) {
          // Check if this is a permanent failure or transient
          if (this.isPermanentFailure(e)) {
            this.logger.warn("Removing voluntary exit due to permanent validation failure", {
              validatorIndex,
              error: e.message,
              errorCode: e.type.code,
            });
            exitsToRemove.push(validatorIndex);
          } else {
            // Transient conditions not yet met, keep in cache
            this.logger.debug("Voluntary exit not yet ready for broadcasting", {
              validatorIndex,
              error: e.message,
              cacheSize: this.cachedExits.size,
            });
          }
        } else {
          // Unexpected error, log and remove from cache
          this.logger.error("Unexpected error checking voluntary exit, removing from cache", {
            validatorIndex,
            error: (e as Error).message,
          });
          exitsToRemove.push(validatorIndex);
        }
      }
    }

    // Clean up processed exits
    for (const validatorIndex of exitsToRemove) {
      this.cachedExits.delete(validatorIndex);
    }

    if (exitsToRemove.length > 0) {
      this.logger.debug("Cleaned up voluntary exit cache", {
        removed: exitsToRemove.length,
        remaining: this.cachedExits.size,
      });
    }
  }

  /**
   * Determine if a validation error is permanent (will never become valid)
   * or transient (may become valid later).
   *
   * Transient errors: validator not active yet, exit epoch not reached, pending withdrawals
   * Permanent errors: invalid signature, validator already exited, invalid index
   */
  private isPermanentFailure(error: VoluntaryExitError): boolean {
    const errorMessage = error.message.toLowerCase();

    // These are transient conditions that may resolve over time
    const transientIndicators = [
      "not active",
      "not_active_validator",
      "validator_not_active",
      "not withdrawable",
      "withdrawable_epoch",
      "exit epoch",
      "epoch not current",
      "pending withdrawal", // post-Electra
      "pending_withdrawal",
      "too early",
      "future epoch",
    ];

    // If any transient indicator is found, it's not a permanent failure
    const isTransient = transientIndicators.some((indicator) => errorMessage.includes(indicator));

    return !isTransient;
  }

  /**
   * Get the current size of the cache (for metrics/monitoring)
   */
  getCacheSize(): number {
    return this.cachedExits.size;
  }

  /**
   * Get all cached voluntary exits (for debugging/inspection)
   */
  getCachedExits(): phase0.SignedVoluntaryExit[] {
    return Array.from(this.cachedExits.values()).map((cached) => cached.voluntaryExit);
  }

  /**
   * Clear all cached exits (for testing or shutdown)
   */
  clearCache(): void {
    const size = this.cachedExits.size;
    this.cachedExits.clear();
    if (size > 0) {
      this.logger.info("Cleared voluntary exit cache", {clearedCount: size});
    }
  }

  /**
   * Remove a specific exit from cache (for testing or manual intervention)
   */
  removeFromCache(validatorIndex: number): boolean {
    const existed = this.cachedExits.has(validatorIndex);
    this.cachedExits.delete(validatorIndex);
    if (existed) {
      this.logger.debug("Manually removed voluntary exit from cache", {validatorIndex});
    }
    return existed;
  }
}
