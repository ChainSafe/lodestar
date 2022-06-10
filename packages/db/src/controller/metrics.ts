export interface ILevelDbControllerMetrics {
  dbReadReq: ICounter<"bucket">;
  dbReadItems: ICounter<"bucket">;
  dbWriteReq: ICounter<"bucket">;
  dbWriteItems: ICounter<"bucket">;
}

type Labels<T extends string> = Partial<Record<T, string | number>>;

interface ICounter<T extends string> {
  inc(value?: number): void;
  inc(labels: Labels<T>, value?: number): void;
  inc(arg1?: Labels<T> | number, arg2?: number): void;
}
