import {ApiError} from "./errors.js";

/**
 * Ensures that the array contains unique values, and throws an ApiError
 * otherwise.
 * @param array - The array to check for uniqueness.
 * @param message - The message to put in the ApiError if the array contains
 * duplicates.
 */
export function assertUniqueItems(array: unknown[] | undefined, message: string): void {
  if (!array) {
    return;
  }

  const duplicateItems = array.reduce((partialDuplicateItems: unknown[], item, index) => {
    if (array.indexOf(item) !== index && !partialDuplicateItems.includes(item)) {
      return partialDuplicateItems.concat(item);
    }
    return partialDuplicateItems;
  }, []);

  if (duplicateItems.length) {
    throw new ApiError(400, `${message}: ${duplicateItems.join(", ")}`);
  }
}
