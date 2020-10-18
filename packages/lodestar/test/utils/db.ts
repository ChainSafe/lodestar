import {IFilterOptions} from "@chainsafe/lodestar-db";

/**
 * Helper to filter an array with DB IFilterOptions options
 */
export function filterBy<T>(items: T[], options: IFilterOptions<number>, getter: (item: T) => number): T[] {
  return items.filter(
    (item) =>
      (options.gt === undefined || getter(item) > options.gt) &&
      (options.gte === undefined || getter(item) >= options.gte) &&
      (options.lt === undefined || getter(item) < options.lt) &&
      (options.lte === undefined || getter(item) <= options.lte)
  );
}
