import {MutableVector} from "@chainsafe/persistent-ts";

const refs: any[] = [];
const xs: number[] = [];
const arrayBuffersArr: number[] = [];
const externalArr: number[] = [];
const heapTotal: number[] = [];
const heapUsed: number[] = [];
const rss: number[] = [];

enum TestType {
  ArrayNew,
  ArraySpread,
  ArraySpreadAndMutate,
  MutableVector,
  MutableVectorClone,
  MutableVectorCloneAndMutate,
  Set,
  Map,
}

const size = 100;
const testType = TestType.Set;

let arrayNumGlobal: number[] | null = null;
let mutableVectorGlobal: MutableVector<number> | null = null;

for (let i = 0; i < 1e8; i++) {
  switch (testType as TestType) {
    // size | 100    | 1000   |
    // ---- | ------ | ------ |
    // rssM | 855.46 | 8107.7 |
    case TestType.ArrayNew: {
      const arrNum = new Array(size);
      for (let j = 0; j < size; j++) {
        arrNum[j] = j;
      }
      refs.push(arrNum);
      break;
    }

    // size | 100    | 1000   |
    // ---- | ------ | ------ |
    // rssM | 61.03  | 59.55  |
    case TestType.ArraySpread: {
      if (!arrayNumGlobal) {
        arrayNumGlobal = Array.from({length: size}, (_, k) => k);
        refs.push(arrayNumGlobal);
      }
      refs.push([...arrayNumGlobal]);
      break;
    }

    // size | 100    | 1000   |
    // ---- | ------ | ------ |
    // rssM | 805.3  | 6240.8 |
    case TestType.ArraySpreadAndMutate: {
      if (!arrayNumGlobal) {
        arrayNumGlobal = Array.from({length: size}, (_, k) => k);
        refs.push(arrayNumGlobal);
      }
      const arrNew = [...arrayNumGlobal];
      arrNew[Math.floor(size / 2)] = i;
      refs.push(arrNew);
      break;
    }

    // size | 100    | 1000   | 10000  |
    // ---- | ------ | ------ | ------ |
    // rssM | 1817.4 | 15518. | 154335 |
    case TestType.MutableVector: {
      const items = createArray(size);
      const mutableVector = MutableVector.from(items);
      refs.push(mutableVector);
      break;
    }

    // size | 100    | 1000   |
    // ---- | ------ | ------ |
    // rssM | 58.68  | 55.89  |
    case TestType.MutableVectorClone: {
      if (!mutableVectorGlobal) {
        const items = createArray(size);
        mutableVectorGlobal = MutableVector.from(items);
      }
      refs.push(mutableVectorGlobal.clone());
      break;
    }

    // Grid of size / changes, all values = rssM in bytes
    //       | 100    | 1000   | 10000  |
    // ----- | ------ | ------ | ------ |
    // 1     | 793.45 | 801.53 | 1137.9 |
    // 10    | 803.98 | 802.36 | 1144.9 |
    // 100   | 1573.2 | 1826.4 | 2172.0 |
    // 1000  | -      | 11250. | 11886. |
    // 10000 | -      | -      | 111365 |
    case TestType.MutableVectorCloneAndMutate: {
      if (!mutableVectorGlobal) {
        const items = createArray(size);
        mutableVectorGlobal = MutableVector.from(items);
      }
      const newArr = mutableVectorGlobal.clone();
      for (let j = 0; j < 10000; j++) {
        newArr.set(j, i);
      }
      refs.push(newArr);
      break;
    }

    // size | 100    | 1000   |
    // ---- | ------ | ------ |
    // rssM | 2646.8 | 20855. |
    case TestType.Set: {
      const set = new Set<number>();
      for (let j = 0; j < size; j++) {
        set.add(j);
      }
      refs.push(set);
      break;
    }

    // size | 100    | 1000   |
    // ---- | ------ | ------ |
    // rssM | 3668.4 | 29089. |
    case TestType.Map: {
      const map = new Map<number, number>();
      for (let j = 0; j < size; j++) {
        map.set(j, j);
      }
      refs.push(map);
      break;
    }

    default: {
      throw Error(`Unknown TestType: ${testType}`);
    }
  }

  // Stores 5 floating point numbers every 5000 pushes to refs.
  // The added memory should be negligible against refs, and linearRegression
  // local vars will get garbage collected and won't show up in the .m result

  if (i % 5000 === 0) {
    xs.push(i);
    const memoryUsage = process.memoryUsage();
    arrayBuffersArr.push(memoryUsage.arrayBuffers);
    externalArr.push(memoryUsage.external);
    heapTotal.push(memoryUsage.heapTotal);
    heapUsed.push(memoryUsage.heapUsed);
    rss.push(memoryUsage.rss);

    const arrayBuffersM = linearRegression(xs, arrayBuffersArr).m;
    const externalM = linearRegression(xs, externalArr).m;
    const heapTotalM = linearRegression(xs, heapTotal).m;
    const heapUsedM = linearRegression(xs, heapUsed).m;
    const rssM = linearRegression(xs, rss).m;

    // eslint-disable-next-line no-console
    console.log(i, {arrayBuffersM, externalM, heapTotalM, heapUsedM, rssM});
  }
}

function createArray(n: number): number[] {
  const items: number[] = [];
  for (let i = 0; i < n; i++) {
    items.push(i);
  }
  return items;
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
