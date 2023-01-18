// zero is considered first index in the range
type NeedleFunc = (needle: number) => void;

export function showProgress({
  total,
  signal,
  frequencyMs,
  progress,
}: {
  total: number;
  signal: AbortSignal;
  frequencyMs: 1000;
  progress: (opts: {current: number; total: number; percentage: number; ratePerSec: number}) => void;
}): NeedleFunc {
  let current = 0;
  let last = 0;

  const needle: NeedleFunc = (needle: number) => {
    // zero is considered first index in the range
    current = needle + 1;
  };

  const internalId = setInterval(() => {
    progress({
      current,
      total,
      ratePerSec: ((current - last) / frequencyMs) * 1000,
      percentage: (current / total) * 100,
    });

    last = current;
    if (current >= total) {
      clearInterval(internalId);
    }
  }, frequencyMs);

  signal.addEventListener("abort", () => {
    clearInterval(internalId);
  });

  return needle;
}
