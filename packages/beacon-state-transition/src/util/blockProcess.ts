import {phase0} from "../../../types/lib";

export function getEmptyBlockProcess(): BlockProcess {
  return {
    blockRootCache: new Map<phase0.Slot, phase0.Root>(),
    validatorExitCache: {},
  };
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface BlockProcess {
  blockRootCache: Map<phase0.Slot, phase0.Root>;
  validatorExitCache: {
    exitQueueEpoch?: number;
    exitQueueChurn?: number;
    churnLimit?: number;
  };
}
