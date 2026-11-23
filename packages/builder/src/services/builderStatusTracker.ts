import {ApiClient} from "@lodestar/api";
import {BuilderIndex, BuilderStatus, Epoch} from "@lodestar/types";
import {Logger, isErrorAborted, prettyGweiToEth} from "@lodestar/utils";
import {getBuilderStatus} from "../identity.js";
import {Metrics, builderStatusValue} from "../metrics.js";

/**
 * Service for tracking builder status.
 * Provides regular builder status, balance and pending payments updates for bidding and operator diagnostics.
 */
export class BuilderStatusTracker {
  private readonly api: ApiClient;
  private readonly logger: Logger;
  private readonly index: BuilderIndex;
  private readonly metrics: Metrics | null;

  private status?: BuilderStatus;
  private balanceGwei?: number;
  private pendingPaymentsGwei = 0;

  constructor(api: ApiClient, logger: Logger, index: BuilderIndex, metrics: Metrics | null) {
    this.api = api;
    this.logger = logger;
    this.index = index;
    this.metrics = metrics;
  }

  /**
   * Polls the builder from the head state. Returns true if balance and pending payments were updated, they are
   * only updated together to keep the amount that can cover bids consistent.
   */
  async poll(currentEpoch: Epoch): Promise<boolean> {
    // A payment moves from the pending payments to the pending withdrawals and is then debited from the balance.
    // Reading in that order counts a payment twice if it moves between the requests instead of missing it
    const pendingPaymentsGwei = await this.fetchPendingPaymentsGwei();
    const builderStatus = await getBuilderStatus(this.api, this.logger, this.index);
    if (builderStatus === null) {
      return false;
    }

    if (this.status !== undefined && this.status !== builderStatus.status) {
      this.logger.info("Builder status changed", {from: this.status, to: builderStatus.status, epoch: currentEpoch});
    }
    this.status = builderStatus.status;
    this.metrics?.builderStatus.set(builderStatusValue[builderStatus.status]);
    if (pendingPaymentsGwei === null) {
      return false;
    }

    this.balanceGwei = builderStatus.balance;
    this.pendingPaymentsGwei = pendingPaymentsGwei;
    this.logger.info("Builder status", {
      status: builderStatus.status,
      balance: prettyGweiToEth(builderStatus.balance),
      pendingPayments: prettyGweiToEth(pendingPaymentsGwei),
      epoch: currentEpoch,
    });
    this.metrics?.builderBalance.set(builderStatus.balance);
    this.metrics?.builderPendingPayments.set(pendingPaymentsGwei);
    return true;
  }

  getStatus(): {status: BuilderStatus | undefined; balance: number | undefined; pendingPaymentsGwei: number} {
    return {
      status: this.status,
      balance: this.balanceGwei,
      pendingPaymentsGwei: this.pendingPaymentsGwei,
    };
  }

  /**
   * Value of won bids the builder still has to pay, the pending payments and pending withdrawals of the head state.
   * Matches `get_pending_balance_to_withdraw_for_builder`, the amount the beacon node deducts from the balance
   * when it checks whether the builder can cover a bid.
   */
  private async fetchPendingPaymentsGwei(): Promise<number | null> {
    try {
      const pendingPayments = (await this.api.beacon.getBuilderPendingPayments({stateId: "head"})).value();
      const pendingWithdrawals = (await this.api.beacon.getBuilderPendingWithdrawals({stateId: "head"})).value();

      let total = 0;
      for (const {withdrawal} of pendingPayments) {
        if (withdrawal.builderIndex === this.index) {
          total += withdrawal.amount;
        }
      }
      for (const withdrawal of pendingWithdrawals) {
        if (withdrawal.builderIndex === this.index) {
          total += withdrawal.amount;
        }
      }
      return total;
    } catch (e) {
      if (!isErrorAborted(e)) {
        this.logger.warn("Couldn't fetch the builder pending payments", {}, e as Error);
      }
      return null;
    }
  }
}
