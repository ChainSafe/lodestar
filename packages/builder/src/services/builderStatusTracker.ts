import {ApiClient} from "@lodestar/api";
import {BuilderIndex, BuilderStatus, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {getBuilderStatus} from "../identity.js";

/**
 * Service for tracking builder status.
 * Provides regular builder status and balance updates for operator diagnostics.
 */
export class BuilderStatusTracker {
  private readonly api: ApiClient;
  private readonly logger: Logger;
  private readonly index: BuilderIndex;

  private status?: BuilderStatus;
  private balanceGwei?: number;

  constructor(api: ApiClient, logger: Logger, index: BuilderIndex) {
    this.api = api;
    this.logger = logger;
    this.index = index;
  }

  async poll(slot: Slot) {
    const builderStatus = await getBuilderStatus(this.api, this.logger, this.index);
    if (builderStatus !== null) {
      if (this.status !== undefined && this.status !== builderStatus.status) {
        this.logger.info("Builder status changed", {from: this.status, to: builderStatus.status, slot});
      }
      this.status = builderStatus.status;
      this.balanceGwei = builderStatus.balance;
      this.logger.debug("Builder status", {status: builderStatus.status, balance: builderStatus.balance, slot});
    }
  }

  getStatus(): {status: BuilderStatus | undefined; balance: number | undefined} {
    return {
      status: this.status,
      balance: this.balanceGwei,
    };
  }
}
