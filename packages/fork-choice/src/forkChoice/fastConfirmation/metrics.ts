import {MetricsRegisterExtra} from "@lodestar/utils";

export type FastConfirmationMetrics = ReturnType<typeof getFastConfirmationMetrics>;

export enum FastConfirmationSteps {
  updateHead = "updateHead",
  buildCache = "buildCache",
  buildSnapshot = "buildSnapshot",
  runRules = "runRules",
}

export function getFastConfirmationMetrics(register: MetricsRegisterExtra) {
  return {
    fastConfirmation: {
      totalDuration: register.histogram({
        name: "lodestar_fast_confirmation_duration_seconds",
        help: "Time to run Fast Confirmation Rule algorithm",
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
      }),
      stepsDuration: register.histogram<{step: FastConfirmationSteps}>({
        name: "lodestar_fast_confirmation_steps_duration_seconds",
        help: "Time to run Fast Confirmation Steps",
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
        labelNames: ["step"],
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
      resets: register.gauge({
        name: "lodestar_fast_confirmation_resets_total",
        help: "Count of fast confirmation resets due to reorgs",
      }),
    },
  };
}
