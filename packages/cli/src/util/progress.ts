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
  let internalId: NodeJS.Timeout;

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
      percentage: current && total ? (current / total) * 100 : 100,
    });

    last = current;
    lastProcessTime = currentTime;

    if (current >= total) {
      clearInterval(internalId);
    }
  };

  if (total > 0) {
    internalId = setInterval(processProgress, frequencyMs);
  }

  signal.addEventListener("abort", () => {
    clearInterval(internalId);
  });

  return needle;
}
