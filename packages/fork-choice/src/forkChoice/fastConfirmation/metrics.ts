import {MetricsRegisterExtra} from "@lodestar/utils";

export type FCRMetrics = ReturnType<typeof getFCRMetrics>;

export function getFCRMetrics(register: MetricsRegisterExtra) {
  return {
    fastConfirmation: {
      duration: register.histogram({
        name: "lodestar_fast_confirmation_duration_seconds",
        help: "Time to run Fast Confirmation Rule algorithm",
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      }),
      confirmedEpoch: register.gauge({
        name: "lodestar_fast_confirmation_confirmed_epoch",
        help: "Current confirmed epoch from fast confirmation",
      }),
      confirmedSlot: register.gauge({
        name: "lodestar_fast_confirmation_confirmed_slot",
        help: "Current confirmed slot from fast confirmation",
      }),
      votesTracked: register.gauge({
        name: "lodestar_fast_confirmation_votes_tracked",
        help: "Number of checkpoint votes tracked by fast confirmation",
      }),
      resets: register.counter({
        name: "lodestar_fast_confirmation_resets_total",
        help: "Count of fast confirmation resets due to reorgs",
      }),
    },
  };
}
