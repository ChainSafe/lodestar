import type {BoardPr} from "./github.ts";

export const PR_RECONCILIATION_FAILED_CODE = "PROJECT_BOARD_PR_RECONCILIATION_FAILED";
export const SWEEP_RECONCILIATION_FAILED_CODE = "PROJECT_BOARD_SWEEP_RECONCILIATION_FAILED";

export interface SweepFailure {
  pr: string;
  error: string;
}

export class SweepReconciliationError extends Error {
  readonly code = SWEEP_RECONCILIATION_FAILED_CODE;
  readonly metadata: {attempted: number; failed: number; failedPrs: string[]};

  constructor(attempted: number, failures: SweepFailure[]) {
    const metadata = {attempted, failed: failures.length, failedPrs: failures.map((failure) => failure.pr)};
    super(
      `${SWEEP_RECONCILIATION_FAILED_CODE}: ${failures.length}/${attempted} PR reconciliations failed; context=${JSON.stringify(metadata)}`,
    );
    this.name = "SweepReconciliationError";
    this.metadata = metadata;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultLogFailure(failure: SweepFailure): void {
  console.error(`${failure.pr}: reconciliation failed`, {
    code: PR_RECONCILIATION_FAILED_CODE,
    error: failure.error,
  });
}

export async function reconcileSweep(
  prs: BoardPr[],
  reconcile: (pr: BoardPr) => Promise<void>,
  logFailure: (failure: SweepFailure) => void = defaultLogFailure,
): Promise<void> {
  const failures: SweepFailure[] = [];
  for (const pr of prs) {
    try {
      await reconcile(pr);
    } catch (error: unknown) {
      const failure = {pr: `${pr.owner}/${pr.repo}#${pr.number}`, error: errorMessage(error)};
      failures.push(failure);
      logFailure(failure);
    }
  }

  if (failures.length > 0) {
    throw new SweepReconciliationError(prs.length, failures);
  }
}
