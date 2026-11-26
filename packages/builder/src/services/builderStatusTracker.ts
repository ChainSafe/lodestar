import {ApiClient, routes} from "@lodestar/api";
import {BuilderIndex, BuilderStatus, Epoch, gloas} from "@lodestar/types";
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
   * Polls the builder from `stateId`, all requests read the same state if it is a state root. Returns the pending
   * payments of that state if balance and pending payments were updated, they are only updated together to keep
   * the amount that can cover bids consistent.
   */
  async poll(
    currentEpoch: Epoch,
    stateId: routes.beacon.StateId = "head"
  ): Promise<gloas.BuilderPendingPayment[] | null> {
    // A payment moves from the pending payments to the pending withdrawals and is then debited from the balance.
    // Without a state root each request resolves the head on its own, reading in that order counts a payment twice
    // if it moves between the requests instead of missing it
    const pending = await this.fetchPendingPayments(stateId);
    const builderStatus = await getBuilderStatus(this.api, this.logger, this.index, stateId);
    if (builderStatus === null) {
      return null;
    }

    if (this.status !== undefined && this.status !== builderStatus.status) {
      this.logger.info("Builder status changed", {from: this.status, to: builderStatus.status, epoch: currentEpoch});
    }
    this.status = builderStatus.status;
    this.metrics?.builderStatus.set(builderStatusValue[builderStatus.status]);
    if (pending === null) {
      return null;
    }

    this.balanceGwei = builderStatus.balance;
    this.pendingPaymentsGwei = pending.totalGwei;
    this.logger.info("Builder status", {
      status: builderStatus.status,
      balance: prettyGweiToEth(builderStatus.balance),
      pendingPayments: prettyGweiToEth(pending.totalGwei),
      epoch: currentEpoch,
    });
    this.metrics?.builderBalance.set(builderStatus.balance);
    this.metrics?.builderPendingPayments.set(pending.totalGwei);
    return pending.payments;
  }

  getStatus(): {status: BuilderStatus | undefined; balance: number | undefined; pendingPaymentsGwei: number} {
    return {
      status: this.status,
      balance: this.balanceGwei,
      pendingPaymentsGwei: this.pendingPaymentsGwei,
    };
  }

  /**
   * Pending payments of the state and the value of won bids the builder still has to pay, its pending payments and
   * pending withdrawals. The value matches `get_pending_balance_to_withdraw_for_builder`, the amount the beacon node
   * deducts from the balance when it checks whether the builder can cover a bid.
   */
  private async fetchPendingPayments(
    stateId: routes.beacon.StateId
  ): Promise<{payments: gloas.BuilderPendingPayment[]; totalGwei: number} | null> {
    try {
      const payments = (await this.api.beacon.getBuilderPendingPayments({stateId})).value();
      const pendingWithdrawals = (await this.api.beacon.getBuilderPendingWithdrawals({stateId})).value();

      let totalGwei = 0;
      for (const {withdrawal} of payments) {
        if (withdrawal.builderIndex === this.index) {
          totalGwei += withdrawal.amount;
        }
      }
      for (const withdrawal of pendingWithdrawals) {
        if (withdrawal.builderIndex === this.index) {
          totalGwei += withdrawal.amount;
        }
      }
      return {payments, totalGwei};
    } catch (e) {
      if (!isErrorAborted(e)) {
        this.logger.warn("Couldn't fetch the builder pending payments", {}, e as Error);
      }
      return null;
    }
  }
}
