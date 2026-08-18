import {BuilderStatus} from "@lodestar/types";
import {MetricsRegisterExtra} from "@lodestar/utils";

export type Metrics = ReturnType<typeof getMetrics>;

export type LodestarGitData = {
  /** "0.16.0 developer/feature-1 ac99f2b5" */
  version: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit: string;
  /** "hoodi" */
  network: string;
};

export const builderStatusValue: Record<BuilderStatus, number> = {pending: 0, active: 1, exited: 2};

export function getMetrics(register: MetricsRegisterExtra, gitData: LodestarGitData) {
  register
    .gauge<LodestarGitData>({
      name: "lodestar_version",
      help: "Lodestar version",
      labelNames: Object.keys(gitData) as [keyof LodestarGitData],
    })
    .set(gitData, 1);

  return {
    builderStatus: register.gauge({
      name: "bc_status",
      help: "Current builder status: pending=0, active=1, exited=2",
    }),
    builderBalanceGwei: register.gauge({
      name: "bc_balance_gwei",
      help: "Current builder balance in gwei",
    }),
  };
}
