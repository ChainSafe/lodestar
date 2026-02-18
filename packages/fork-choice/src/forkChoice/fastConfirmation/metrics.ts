import {MetricsRegisterExtra} from "@lodestar/utils";

export type FCRMetrics = ReturnType<typeof getFCRMetrics>;

export function getFCRMetrics(register: MetricsRegisterExtra) {
  return {
    fcr: {
      duration: register.histogram({
        name: "lodestar_fcr_duration_seconds",
        help: "Time to run Fast Confirmation Rule algorithm",
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      }),
      confirmedEpoch: register.gauge({
        name: "lodestar_fcr_confirmed_epoch",
        help: "Current confirmed epoch from FCR",
      }),
      confirmedSlot: register.gauge({
        name: "lodestar_fcr_confirmed_slot",
        help: "Current confirmed slot from FCR",
      }),
      votesTracked: register.gauge({
        name: "lodestar_fcr_votes_tracked",
        help: "Number of checkpoint votes tracked by FCR",
      }),
      resets: register.counter({
        name: "lodestar_fcr_resets_total",
        help: "Count of FCR resets due to reorgs",
      }),
    },
  };
}
