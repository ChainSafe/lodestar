import {ApiClient, routes} from "@lodestar/api";
import {BuilderIndex, BuilderStatus, Epoch} from "@lodestar/types";
import {Logger, prettyGweiToEth} from "@lodestar/utils";
import {getBuilderStatus} from "../identity.js";
import {Metrics, builderStatusValue} from "../metrics.js";

/**
 * Service for tracking builder status.
 * Provides regular builder status and balance updates for operator diagnostics.
 */
export class BuilderStatusTracker {
  private readonly api: ApiClient;
  private readonly logger: Logger;
  private readonly index: BuilderIndex;
  private readonly metrics: Metrics | null;

  private readonly pollId: routes.beacon.BuilderId;
  private readonly assumed: boolean;

  private status?: BuilderStatus;
  private balanceGwei?: number;
  private verified = false;
  private mismatch = false;

  constructor(
    api: ApiClient,
    logger: Logger,
    index: BuilderIndex,
    metrics: Metrics | null,
    /** Status the builder was resolved with, the beacon node can't be polled for it before the first Gloas block */
    initial?: {status: BuilderStatus; balance: number},
    /** Pubkey of an assumed identity: polled instead of the index, so the registry can contradict the assumed index */
    assumedPubkey?: string
  ) {
    this.api = api;
    this.logger = logger;
    this.index = index;
    this.metrics = metrics;
    this.status = initial?.status;
    this.balanceGwei = initial?.balance;
    this.pollId = assumedPubkey ?? index;
    this.assumed = assumedPubkey !== undefined;
  }

  async poll(currentEpoch: Epoch) {
    if (this.mismatch) {
      return;
    }
    const builderStatus = await getBuilderStatus(this.api, this.logger, this.pollId);
    if (builderStatus !== null && builderStatus.index !== this.index) {
      // Bids are signed with the assumed index, every one of them would be invalid: stop bidding and let the
      // operator restart without the assumption
      this.mismatch = true;
      this.status = undefined;
      this.balanceGwei = undefined;
      this.logger.error("Builder index differs from the assumed one, not bidding", {
        assumed: this.index,
        actual: builderStatus.index,
        epoch: currentEpoch,
      });
      return;
    }
    if (builderStatus !== null && this.assumed && !this.verified) {
      this.verified = true;
      this.logger.info("Assumed builder identity confirmed by the beacon node", {
        index: this.index,
        epoch: currentEpoch,
      });
    }
    if (builderStatus !== null) {
      if (this.status !== undefined && this.status !== builderStatus.status) {
        this.logger.info("Builder status changed", {from: this.status, to: builderStatus.status, epoch: currentEpoch});
      }
      this.status = builderStatus.status;
      this.balanceGwei = builderStatus.balance;
      this.logger.info("Builder status", {
        builderIndex: this.index,
        status: builderStatus.status,
        balance: prettyGweiToEth(builderStatus.balance),
        epoch: currentEpoch,
      });
      this.metrics?.builderStatus.set(builderStatusValue[builderStatus.status]);
      this.metrics?.builderBalance.set(builderStatus.balance);
    }
  }

  getStatus(): {status: BuilderStatus | undefined; balance: number | undefined} {
    return {
      status: this.status,
      balance: this.balanceGwei,
    };
  }
}
