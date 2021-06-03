import fs from "fs";

/* eslint-disable no-console */

export type BenchmarkOpts = {
  runs?: number;
  maxMs?: number;
  minMs?: number;
};

export type BenchmarkResult = {
  id: string;
  averageNs: number;
  runsDone: number;
  factor?: number;
};

export class BenchmarkRunner {
  opts: BenchmarkOpts;
  results: BenchmarkResult[] = [];
  constructor(title: string, opts?: BenchmarkOpts) {
    this.opts = opts || {};
    console.log(formatTitle(title));
  }

  async run<T1, T2 = T1, R = void>(opts: RunOpts<T1, T2, R>): Promise<number> {
    const {averageNs, runsDone} = await doRun(opts, this.opts);
    this.results.push({id: opts.id, averageNs, runsDone});
    console.log(formatResultRow({id: opts.id, averageNs, runsDone})); // ±1.74%

    return averageNs;
  }

  group(): BenchmarkGroupRunner {
    return new BenchmarkGroupRunner(this.opts || {}, this.results);
  }

  done(): void {
    const filepath = process.env.BENCHMARK_OUTPUT_PATH;
    if (filepath) {
      fs.writeFileSync(filepath, formatAsBenchmarkJs(this.results));
    }
  }
}

class BenchmarkGroupRunner {
  averageNs: number | null = null;
  opts: BenchmarkOpts;
  results: BenchmarkResult[];
  constructor(opts: BenchmarkOpts, results: BenchmarkResult[]) {
    this.opts = opts || {};
    this.results = results;
    console.log("---");
  }

  async run<T1, T2 = T1, R = void>(opts: RunOpts<T1, T2, R>): Promise<number> {
    const {averageNs, runsDone} = await doRun(opts, this.opts);
    this.results.push({id: opts.id, averageNs, runsDone});

    if (this.averageNs === null) this.averageNs = averageNs;
    const factor = averageNs / this.averageNs;

    console.log(formatResultRow({id: opts.id, averageNs, runsDone, factor})); // ±1.74%

    return averageNs;
  }
}

async function doRun<T1, T2 = T1, R = void>(
  {before, beforeEach, run, check, id, ...opts}: RunOpts<T1, T2, R>,
  extraOpts: BenchmarkOpts
): Promise<{averageNs: number; runsDone: number}> {
  const runs = opts.runs || extraOpts.runs || 512;
  const maxMs = opts.maxMs || extraOpts.maxMs || 2000;
  const minMs = opts.minMs || extraOpts.minMs || 100;

  const diffsNanoSec: bigint[] = [];

  const inputAll = before ? await before() : undefined;

  let start = Date.now();
  let i = 0;
  while ((i++ < runs || Date.now() - start < minMs) && Date.now() - start < maxMs) {
    const input = beforeEach ? await beforeEach(inputAll, i) : ((inputAll as unknown) as T2);

    const start = process.hrtime.bigint();
    const result = run(input);
    const end = process.hrtime.bigint();

    if (check && check(result)) throw Error("Result fails check test");

    diffsNanoSec.push(end - start);
  }

  const average = averageBigint(diffsNanoSec);
  const averageNs = Number(average);

  return {averageNs, runsDone: i - 1};
}

type PromiseOptional<T> = T | Promise<T>;

type RunOpts<T1, T2 = T1, R = void> = {
  before?: () => PromiseOptional<T1>;
  beforeEach?: (arg: T1 | undefined, i: number) => PromiseOptional<T2>;
  run: (input: T2) => R;
  check?: (result: R) => boolean;
  id: string;
} & BenchmarkOpts;

function averageBigint(arr: bigint[]): bigint {
  const total = arr.reduce((total, value) => total + value);
  return total / BigInt(arr.length);
}

function formatResultRow({id, averageNs, runsDone, factor}: BenchmarkResult): string {
  const precision = 7;
  const idLen = 64;

  const opsPerSec = 1e9 / averageNs;

  // ================================================================================================================
  // Scalar multiplication G1 (255-bit, constant-time)                              7219.330 ops/s       138517 ns/op
  // Scalar multiplication G2 (255-bit, constant-time)                              3133.117 ops/s       319171 ns/op

  let row = [
    factor === undefined ? "" : `x${factor.toFixed(2)}`.padStart(6),
    `${opsPerSec.toPrecision(precision).padStart(13)} ops/s`,
    `${averageNs.toPrecision(precision).padStart(13)} ns/op`,
    `${String(runsDone).padStart(6)} runs`,
  ].join(" ");

  return id.slice(0, idLen).padEnd(idLen) + " " + row;
}

/**
 * Return results in benckmark.js output format
 * ```
 * fib(10) x 1,431,759 ops/sec ±0.74% (93 runs sampled)
 * ```
 */
function formatAsBenchmarkJs(results: BenchmarkResult[]): string {
  return results
    .map(({id, averageNs, runsDone}) => `${id} x ${1e9 / averageNs} ops/sec ±0.00% (${runsDone} runs sampled)`)
    .join("\n");
}

export function formatTitle(title: string): string {
  return `
${title}
${"=".repeat(64)}`;
}
