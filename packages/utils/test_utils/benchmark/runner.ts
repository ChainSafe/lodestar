import fs from "fs";
import path from "path";

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
  runsNs: bigint[];
  factor?: number;
};

export class BenchmarkRunner {
  results: BenchmarkResult[] = [];
  constructor(private readonly title: string, private readonly opts: BenchmarkOpts = {}) {
    this.opts = opts || {};
    console.log(formatTitle(title));
  }

  async run<T1, T2 = T1, R = void>(opts: RunOpts<T1, T2, R>): Promise<number> {
    const result = await doRun(opts, this.opts);
    return this.onRun(result);
  }

  group(): BenchmarkGroupRunner {
    return new BenchmarkGroupRunner(this.opts || {}, this.onRun.bind(this));
  }

  done(): void {
    const filepath = process.env.BENCHMARK_OUTPUT_PATH;
    if (filepath) {
      // path.resolve(filePath) resolves to something like
      // /home/runner/work/lodestar/lodestar/packages/beacon-state-transition/benchmark-output.txt
      const absoluteFilePath = path.resolve("..", "..", filepath);
      fs.appendFileSync(absoluteFilePath, formatAsBenchmarkJs(this.results));
    }
  }

  private onRun(result: BenchmarkResult): number {
    this.results.push(result);
    console.log(formatResultRow(result)); // ±1.74%

    // Persist full results if requested
    if (process.env.BENCHMARK_RESULTS_DIR) {
      const filename = `${this.title.replace(/\s/g, "-")}_${result.id}.csv`;
      const filepath = path.join(process.env.BENCHMARK_RESULTS_DIR, filename);
      fs.writeFileSync(filepath, result.runsNs.join("\n"));
    }

    return result.averageNs;
  }
}

class BenchmarkGroupRunner {
  averageNs: number | null = null;
  constructor(private readonly opts: BenchmarkOpts, private readonly onRun: (result: BenchmarkResult) => number) {
    console.log("---");
  }

  async run<T1, T2 = T1, R = void>(opts: RunOpts<T1, T2, R>): Promise<number> {
    const result = await doRun(opts, this.opts);

    // Attach factor to result
    if (this.averageNs === null) this.averageNs = result.averageNs;
    result.factor = result.averageNs / this.averageNs;

    return this.onRun(result);
  }
}

async function doRun<T1, T2 = T1, R = void>(
  {before, beforeEach, run, check, ...opts}: RunOpts<T1, T2, R>,
  extraOpts: BenchmarkOpts
): Promise<BenchmarkResult> {
  const runs = opts.runs || extraOpts.runs || 512;
  const maxMs = opts.maxMs || extraOpts.maxMs || 2000;
  const minMs = opts.minMs || extraOpts.minMs || 100;

  const runsNs: bigint[] = [];

  const inputAll = before ? await before() : undefined;

  const start = Date.now();
  let i = 0;
  while ((i++ < runs || Date.now() - start < minMs) && Date.now() - start < maxMs) {
    const input = beforeEach ? await beforeEach(inputAll, i) : ((inputAll as unknown) as T2);

    const start = process.hrtime.bigint();
    const result = run(input);
    const end = process.hrtime.bigint();

    if (check && check(result)) throw Error("Result fails check test");

    runsNs.push(end - start);
  }

  const average = averageBigint(runsNs);
  const averageNs = Number(average);

  return {id: opts.id, averageNs, runsDone: i - 1, runsNs};
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

  const [averageTime, timeUnit] = prettyTime(averageNs);
  const row = [
    factor === undefined ? "" : `x${factor.toFixed(2)}`.padStart(6),
    `${opsPerSec.toPrecision(precision).padStart(13)} ops/s`,
    `${averageTime.toPrecision(precision).padStart(13)} ${timeUnit}/op`,
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
  return (
    results
      .map(({id, averageNs, runsDone}) => `${id} x ${1e9 / averageNs} ops/sec ±0.00% (${runsDone} runs sampled)`)
      .join("\n") + "\n"
  );
}

export function formatTitle(title: string): string {
  return `
${title}
${"=".repeat(64)}`;
}

function prettyTime(nanoSec: number): [number, string] {
  if (nanoSec > 1e9) return [nanoSec / 1e9, " s"];
  if (nanoSec > 1e6) return [nanoSec / 1e6, "ms"];
  if (nanoSec > 1e3) return [nanoSec / 1e3, "us"];
  return [nanoSec, "ns"];
}
