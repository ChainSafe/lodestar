// eslint-disable-next-line @typescript-eslint/naming-convention
export interface BlockProcess {
  validatorExitCache?: {
    exitQueueEpoch: number;
    exitQueueChurn: number;
    churnLimit: number;
  };
}
