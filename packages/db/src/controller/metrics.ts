export type LevelDbControllerMetrics = {
  dbReadReq: Counter<"bucket">;
  dbReadItems: Counter<"bucket">;
  dbWriteReq: Counter<"bucket">;
  dbWriteItems: Counter<"bucket">;
  dbSizeTotal: Gauge;
  dbApproximateSizeTime: Histogram;
};

type Labels<T extends string> = Partial<Record<T, string | number>>;

interface Counter<T extends string> {
  inc(value?: number): void;
  inc(labels: Labels<T>, value?: number): void;
  inc(arg1?: Labels<T> | number, arg2?: number): void;
}

interface Gauge<T extends string = string> {
  set(value: number): void;
  set(labels: Labels<T>, value: number): void;
  set(arg1?: Labels<T> | number, arg2?: number): void;
}

interface Histogram {
  startTimer(): () => number;
}
