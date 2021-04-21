import {phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IApiClient} from "../api";
import {notAborted} from "../util";
import {IClock} from "../util/clock";

export interface IForkService {
  getFork(): Promise<phase0.Fork>;
}

/**
 * Fork fetching strategy
 * - Fetch fork once per epoch only, at the begining of the epoch
 * - Cache previous' fork value and return it in case of error.
 *   The Fork struct does not change often and its better to return
 *   the cached value than to stop the validator flow
 */
export class ForkService implements IForkService {
  private readonly provider: IApiClient;
  private readonly logger: ILogger;
  private fork: phase0.Fork | null = null;
  /** Store the promise and return it in getFork() for a potential race condition on start */
  private forkPromise: Promise<phase0.Fork> | null = null;
  /** Prevent calling updateFork() more than once at the same time */
  private forkPromisePending = false;

  constructor(provider: IApiClient, logger: ILogger, clock: IClock) {
    this.provider = provider;
    this.logger = logger;

    clock.runEveryEpoch(this.updateFork);
  }

  async getFork(): Promise<phase0.Fork> {
    if (this.fork) return this.fork;
    if (this.forkPromise) return this.forkPromise;
    // This error should never happen if this service is started before the att and block services
    throw Error("Fork not available");
  }

  private updateFork = async (): Promise<void> => {
    if (this.forkPromisePending) {
      return;
    }

    try {
      this.forkPromisePending = true;
      this.forkPromise = this.provider.beacon.state.getFork("head");
      this.fork = await this.forkPromise;
    } catch (e) {
      if (notAborted(e)) this.logger.error("Error updating fork", {}, e as Error);
    } finally {
      this.forkPromisePending = false;
    }
  };
}
