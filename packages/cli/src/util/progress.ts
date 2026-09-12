// zero is considered first index in the range
type NeedleFunc = (needle: number) => void;
type ProgressFunc = (opts: {current: number; total: number; percentage: number; ratePerSec: number}) => void;

export function showProgress({
  total,
  signal,
  frequencyMs,
  progress,
}: {
  total: number;
  signal: AbortSignal;
  frequencyMs: number;
  progress: ProgressFunc;
}): NeedleFunc {
  let current = 0;
  let last = 0;
  let lastProcessTime: number = Date.now();
  let progressIntervalId: NodeJS.Timeout;

  const cleanup = (): void => {
    clearInterval(progressIntervalId);
    signal.removeEventListener("abort", onAbort);
  };

  const onAbort = (): void => {
    cleanup();
  };

  const needle: NeedleFunc = (needle: number) => {
    // zero is considered first index in the range
    current = needle + 1;

    if (current >= total) {
      processProgress();
    }
  };

  const processProgress = (): void => {
    const currentTime = Date.now();
    const processTime = currentTime - lastProcessTime;

    progress({
      current,
      total,
      ratePerSec: processTime === 0 ? 0 : ((current - last) / processTime) * 1000,
      percentage: total ? (current / total) * 100 : 100,
    });

    last = current;
    lastProcessTime = currentTime;

    if (current >= total) {
      cleanup();
    }
  };

  if (total > 0) {
    progressIntervalId = setInterval(processProgress, frequencyMs);
  }

  signal.addEventListener("abort", onAbort, {once: true});

  if (total === 0) {
    cleanup();
  }

  return needle;
}
