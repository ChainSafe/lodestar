/**
 * Disposable data computed on-demand to process blocks faster at the cost of more memory.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface BlockProcess {
  validatorExitCache?: {
    exitQueueEpoch: number;
    exitQueueChurn: number;
    churnLimit: number;
  };
}
