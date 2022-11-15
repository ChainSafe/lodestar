export type TestRunnerMemoryOpts<T> = {
  getInstance: (i: number) => T;
  sampleEvery?: number;
  maxRssBytes?: number;
  maxInstances?: number;
  computeUsedMemory?: (memoryUsage: NodeJS.MemoryUsage) => number;
  logEachSample?: boolean;
  convergeFactor?: number;
};

if (global.gc === undefined) {
  throw Error("Must enable global.gc");
}

export async function testRunnerMemoryGc<T>(opts: TestRunnerMemoryOpts<T>): Promise<void> {
  const {
    getInstance,
    /**
     * How to compute the total memory usage.
     * Defaults to `heapUsed + external`.
     * https://nodejs.org/api/process.html#processmemoryusage
     */
    computeUsedMemory = (memoryUsage) => memoryUsage.heapUsed + memoryUsage.external,
  } = opts;

  const rounds = 10;
  const instancesPerRound = 1000;
  const xs: number[] = [];
  const usedMemoryArr: number[] = [];

  for (let n = 0; n < rounds; n++) {
    global.gc?.();
    global.gc?.();
    await new Promise((r) => setTimeout(r, 100));
    global.gc?.();
    global.gc?.();

    const totalUsedMemoryPrev = computeUsedMemory(process.memoryUsage());

    const refs: T[] = [];
    for (let i = 0; i < instancesPerRound; i++) {
      refs.push(getInstance(i));
    }

    global.gc?.();
    global.gc?.();
    await new Promise((r) => setTimeout(r, 100));
    global.gc?.();
    global.gc?.();

    const totalUsedMemory = computeUsedMemory(process.memoryUsage());

    const totalUsedMemoryDiff = totalUsedMemory - totalUsedMemoryPrev;
    refs.push(null as any);

    xs.push(n);
    usedMemoryArr.push(totalUsedMemoryDiff);

    const usedMemoryReg = linearRegression(xs, usedMemoryArr);
    // eslint-disable-next-line no-console
    console.log("totalUsedMemoryDiff", totalUsedMemoryDiff, usedMemoryReg);
  }
}

export function testRunnerMemory<T>(opts: TestRunnerMemoryOpts<T>): number {
  const {
    getInstance,
    /**
     * Sample memory usage every `sampleEvery` instances
     */
    sampleEvery = 1000,
    /**
     * Stop when `process.memoryUsage().rss > maxRssBytes`.
     */
    maxRssBytes = 2e9,
    /**
     * Stop after creating `maxInstances` instances.
     */
    maxInstances = Infinity,
    /**
     * How to compute the total memory usage.
     * Defaults to `heapUsed + external`.
     * https://nodejs.org/api/process.html#processmemoryusage
     */
    computeUsedMemory = (memoryUsage) => memoryUsage.heapUsed + memoryUsage.external,
    logEachSample,
    convergeFactor = 0.2 / 100, // 0.2%
  } = opts;

  const refs: T[] = [];
  const xs: number[] = [];
  const usedMemoryArr: number[] = [];

  let prevM0 = 0;
  let prevM1 = 0;

  for (let i = 0; i < maxInstances; i++) {
    refs.push(getInstance(i));

    // Stores 5 floating point numbers every 5000 pushes to refs.
    // The added memory should be negligible against refs, and linearRegression
    // local vars will get garbage collected and won't show up in the .m result

    if (i % sampleEvery === 0) {
      global.gc?.();
      global.gc?.();

      const memoryUsage = process.memoryUsage();
      const usedMemory = computeUsedMemory(memoryUsage);

      xs.push(i);
      usedMemoryArr.push(usedMemory);

      if (usedMemoryArr.length > 1) {
        // When is a good time to stop a benchmark? A naive answer is after N milliseconds or M runs.
        // This code aims to stop the benchmark when the average fn run time has converged at a value
        // within a given convergence factor. To prevent doing expensive math to often for fast fn,
        // it only takes samples every `sampleEveryMs`. It stores two past values to be able to compute
        // a very rough linear and quadratic convergence.
        const m = linearRegression(xs, usedMemoryArr).m;

        // Compute convergence (1st order + 2nd order)
        const a = prevM0;
        const b = prevM1;
        const c = m;

        // Approx linear convergence
        const convergence1 = Math.abs(c - a);
        // Approx quadratic convergence
        const convergence2 = Math.abs(b - (a + c) / 2);
        // Take the greater of both to enforce linear and quadratic are below convergeFactor
        const convergence = Math.max(convergence1, convergence2) / a;

        // Okay to stop + has converged, stop now
        if (convergence < convergeFactor) {
          return m;
        }

        if (logEachSample) {
          // eslint-disable-next-line no-console
          console.log(i, memoryUsage.rss / maxRssBytes, {m});
        }

        prevM0 = prevM1;
        prevM1 = m;
      }
    }
  }

  return linearRegression(xs, usedMemoryArr).m;
}

/**
 * From https://github.com/simple-statistics/simple-statistics/blob/d0d177baf74976a2421638bce98ab028c5afb537/src/linear_regression.js
 *
 * [Simple linear regression](http://en.wikipedia.org/wiki/Simple_linear_regression)
 * is a simple way to find a fitted line between a set of coordinates.
 * This algorithm finds the slope and y-intercept of a regression line
 * using the least sum of squares.
 *
 * @param data an array of two-element of arrays,
 * like `[[0, 1], [2, 3]]`
 * @returns object containing slope and intersect of regression line
 * @example
 * linearRegression([[0, 0], [1, 1]]); // => { m: 1, b: 0 }
 */
export function linearRegression(xs: number[], ys: number[]): {m: number; b: number} {
  let m: number, b: number;

  // Store data length in a local variable to reduce
  // repeated object property lookups
  const dataLength = xs.length;

  //if there's only one point, arbitrarily choose a slope of 0
  //and a y-intercept of whatever the y of the initial point is
  if (dataLength === 1) {
    m = 0;
    b = ys[0];
  } else {
    // Initialize our sums and scope the `m` and `b`
    // variables that define the line.
    let sumX = 0,
      sumY = 0,
      sumXX = 0,
      sumXY = 0;

    // Use local variables to grab point values
    // with minimal object property lookups
    let x: number, y: number;

    // Gather the sum of all x values, the sum of all
    // y values, and the sum of x^2 and (x*y) for each
    // value.
    //
    // In math notation, these would be SS_x, SS_y, SS_xx, and SS_xy
    for (let i = 0; i < dataLength; i++) {
      x = xs[i];
      y = ys[i];

      sumX += x;
      sumY += y;

      sumXX += x * x;
      sumXY += x * y;
    }

    // `m` is the slope of the regression line
    m = (dataLength * sumXY - sumX * sumY) / (dataLength * sumXX - sumX * sumX);

    // `b` is the y-intercept of the line.
    b = sumY / dataLength - (m * sumX) / dataLength;
  }

  // Return both values as an object.
  return {
    m: m,
    b: b,
  };
}
