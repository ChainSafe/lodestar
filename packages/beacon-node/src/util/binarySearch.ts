export function binarySearchLte<T>(items: T[], value: number, getter: (item: T) => number): T {
  const lastItem = items.at(-1);

  if (!lastItem) {
    throw new ErrorNoValues();
  }

  const maxValue = getter(lastItem);
  const minValue = getter(items[0]);
  // Shortcut for the actual value
  if (value >= maxValue) {
    return lastItem;
  }
  if (value < minValue) {
    throw new ErrorNoValueMinValue(value, minValue);
  }

  // Binary search of the value in the array
  let min = 0;
  let max = items.length - 1;
  while (max > min) {
    const mid = Math.floor((max + min + 1) / 2);
    if (getter(items[mid]) <= value) {
      min = mid;
    } else {
      max = mid - 1;
    }
  }
  return items[min];
}

export class ErrorBinarySearch extends Error {}

export class ErrorNoValues extends ErrorBinarySearch {
  constructor() {
    super("Empty array to perform binary search");
  }
}

export class ErrorNoValueMinValue extends ErrorBinarySearch {
  value: number;
  minValue: number;
  constructor(value: number, minValue: number) {
    super(`Target value ${value} is less than min value ${minValue}`);
    this.value = value;
    this.minValue = minValue;
  }
}
