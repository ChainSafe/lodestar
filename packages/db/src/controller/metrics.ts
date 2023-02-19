export type LevelDbControllerMetrics = {
  dbReadReq: Counter<"bucket">;
  dbReadItems: Counter<"bucket">;
  dbWriteReq: Counter<"bucket">;
  dbWriteItems: Counter<"bucket">;
  dbSizeTotal: IGauge;
};

type Labels<T extends string> = Partial<Record<T, string | number>>;

interface Counter<T extends string> {
  inc(value?: number): void;
  inc(labels: Labels<T>, value?: number): void;
  inc(arg1?: Labels<T> | number, arg2?: number): void;
}

interface IGauge<T extends string = string> {
  set(value: number): void;
  set(labels: Labels<T>, value: number): void;
  set(arg1?: Labels<T> | number, arg2?: number): void;
}
