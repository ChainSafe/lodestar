import {routes} from "@lodestar/api";
import {ForkName, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {BuilderIndex, ssz} from "@lodestar/types";
import {ApiClientStub, mockApiResponse} from "./apiStub.js";

export function mockGetStateBuildersResponse(
  index: BuilderIndex,
  {
    status = "active",
    pubkey = Buffer.alloc(48),
    balance = 1,
    version = PAYLOAD_BUILDER_VERSION,
  }: {status?: routes.beacon.BuilderStatus; pubkey?: Uint8Array; balance?: number; version?: number} = {}
): Awaited<ReturnType<ApiClientStub["beacon"]["getStateBuilders"]>> {
  const builder = ssz.gloas.Builder.defaultValue();
  builder.balance = balance;
  builder.version = version;
  builder.pubkey = pubkey;
  return mockApiResponse({
    data: [{index, status, builder}],
    meta: {executionOptimistic: true, finalized: false},
  });
}

/**
 * Mocks the pending payments and pending withdrawals of a state, each entry is [builderIndex, amount]. A payment can
 * name its position in the pending payments as third item, it defaults to the position in the list.
 */
export function mockPendingPayments(
  api: ApiClientStub,
  {
    payments = [],
    withdrawals = [],
  }: {payments?: [BuilderIndex, number, number?][]; withdrawals?: [BuilderIndex, number][]} = {}
): void {
  const meta = {executionOptimistic: false, finalized: false, version: ForkName.gloas};
  const toWithdrawal = ([builderIndex, amount]: [BuilderIndex, number, number?]) => ({
    ...ssz.gloas.BuilderPendingWithdrawal.defaultValue(),
    builderIndex,
    amount,
  });

  const pendingPayments = ssz.gloas.BuilderPendingPayments.defaultValue();
  for (const [i, payment] of payments.entries()) {
    pendingPayments[payment[2] ?? i].withdrawal = toWithdrawal(payment);
  }
  api.beacon.getBuilderPendingPayments.mockResolvedValue(mockApiResponse({data: pendingPayments, meta}));
  api.beacon.getBuilderPendingWithdrawals.mockResolvedValue(
    mockApiResponse({data: withdrawals.map(toWithdrawal), meta})
  );
}
