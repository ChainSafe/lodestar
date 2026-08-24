import {Logger} from "@lodestar/logger";
import {IBeaconStateView, VoluntaryExitValidity} from "@lodestar/state-transition";
import {Epoch, ValidatorIndex} from "@lodestar/types";
import {SignedVoluntaryExit} from "@lodestar/types/phase0";
import {isTransientExitValidity} from "../validation/voluntaryExit.js";

type DeferredEntry = {
  exit: SignedVoluntaryExit;
  validity: VoluntaryExitValidity;
  insertedAtEpoch: Epoch;
};

export class DeferredVoluntaryExitPool {
  private pool = new Map<ValidatorIndex, DeferredEntry>();

  constructor(
    private readonly logger: Logger,
    private readonly maxSize = 1024,
    private readonly maxDeferEpochs = 256
  ) {}

  insert(exit: SignedVoluntaryExit, validity: VoluntaryExitValidity, currentEpoch: Epoch): boolean {
    if (!isTransientExitValidity(validity)) return false;
    if (this.pool.size === this.maxSize) return false;
    if (this.pool.has(exit.message.validatorIndex)) return false;

    this.pool.set(exit.message.validatorIndex, {exit, validity, insertedAtEpoch: currentEpoch});

    return true;
  }

  drainProcessableExits(state: IBeaconStateView): SignedVoluntaryExit[] {
    const epoch = state.epoch;
    const validExits: SignedVoluntaryExit[] = [];
    for (const [validatorIndex, entry] of this.pool) {
      try {
        if (epoch - entry.insertedAtEpoch > this.maxDeferEpochs) {
          this.pool.delete(validatorIndex);
          this.logger.debug("Deferred voluntary exit expired", {validatorIndex, lastValidity: entry.validity});
          continue;
        }
        const validity = state.getVoluntaryExitValidity(entry.exit, true);
        if (validity === VoluntaryExitValidity.valid) {
          validExits.push(entry.exit);
          this.pool.delete(validatorIndex);
        } else if (!isTransientExitValidity(validity)) {
          this.logger.debug("Deferred voluntary exit became permanently invalid", {validatorIndex, validity});
          this.pool.delete(validatorIndex);
        }
        // Else if still transient - keep
      } catch (e) {
        this.logger.debug("Processing deferred voluntary exit failed", {validatorIndex}, e as Error);
      }
    }
    return validExits;
  }

  has(validatorIndex: ValidatorIndex): boolean {
    return this.pool.has(validatorIndex);
  }

  size(): number {
    return this.pool.size;
  }
}
