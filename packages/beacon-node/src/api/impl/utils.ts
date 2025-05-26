import {ApiError} from "./errors.js";

/**
 * Ensures that the array contains unique values, and throws an ApiError
 * otherwise.
 * @param array - The array to check for uniqueness.
 * @param message - The message to put in the ApiError if the array contains
 * duplicates.
 */
const ensureUniqueItemsOrThrow = (array: unknown[] | undefined, message: string) => {
  if (!array) {
    return;
  }

  const containsDuplicates = new Set(array).size !== array.length;

  if (containsDuplicates) {
    throw new ApiError(400, message);
  }
};

export default ensureUniqueItemsOrThrow;
