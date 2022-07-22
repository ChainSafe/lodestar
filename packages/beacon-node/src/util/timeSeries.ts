type Point = [number, number]; // [x, y] or here [time, value]

export class TimeSeries {
  private points: Point[] = [];
  private startTimeSec: number;
  private maxPoints: number;

  constructor(opts?: {maxPoints?: number}) {
    this.maxPoints = opts?.maxPoints ?? 1000;
    this.startTimeSec = Date.now() / 1000;
  }

  /** Add TimeSeries entry for value at current time */
  addPoint(value: number, timeMs = Date.now()): void {
    // Substract initial time so x values are not big and cause rounding errors
    const time = timeMs / 1000 - this.startTimeSec;
    this.points.push([time, value]);

    // Limit length by removing old entries
    while (this.points.length > this.maxPoints) {
      this.points.shift();
    }
  }

  /** Compute the slope of all registered points assuming linear regression */
  computeLinearSpeed(): number {
    return linearRegression(this.points).m;
  }

  /** Remove all entries */
  clear(): void {
    this.points = [];
  }
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
function linearRegression(data: Point[]): {m: number; b: number} {
  let m: number, b: number;

  // Store data length in a local variable to reduce
  // repeated object property lookups
  const dataLength = data.length;

  //if there's only one point, arbitrarily choose a slope of 0
  //and a y-intercept of whatever the y of the initial point is
  if (dataLength === 1) {
    m = 0;
    b = data[0][1];
  } else {
    // Initialize our sums and scope the `m` and `b`
    // variables that define the line.
    let sumX = 0,
      sumY = 0,
      sumXX = 0,
      sumXY = 0;

    // Use local variables to grab point values
    // with minimal object property lookups
    let point: Point, x: number, y: number;

    // Gather the sum of all x values, the sum of all
    // y values, and the sum of x^2 and (x*y) for each
    // value.
    //
    // In math notation, these would be SS_x, SS_y, SS_xx, and SS_xy
    for (let i = 0; i < dataLength; i++) {
      point = data[i];
      x = point[0];
      y = point[1];

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
