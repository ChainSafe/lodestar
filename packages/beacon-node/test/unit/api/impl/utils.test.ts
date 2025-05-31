import {describe, expect, it} from "vitest";
import {ApiError} from "../../../../src/api/impl/errors.js";
import {ensureUniqueItemsOrThrow} from "../../../../src/api/impl/utils.js";

describe("api / impl / utils", () => {
  describe("ensureUniqueItemsOrThrow", () => {
    it("should not throw for undefined input", () => {
      expect(() => ensureUniqueItemsOrThrow(undefined, "test message")).not.toThrow();
    });

    it("should not throw for empty array", () => {
      expect(() => ensureUniqueItemsOrThrow([], "test message")).not.toThrow();
    });

    it("should not throw for array with unique values", () => {
      expect(() => ensureUniqueItemsOrThrow([1, 2, 3], "test message")).not.toThrow();
      expect(() => ensureUniqueItemsOrThrow(["a", "b", "c"], "test message")).not.toThrow();
      expect(() => ensureUniqueItemsOrThrow([true, false], "test message")).not.toThrow();
    });

    it("should throw ApiError for array with duplicate values", () => {
      const errorMessage = "Duplicate values found";
      const errorMessageFn = (duplicateItems: unknown[]) =>
        `${errorMessage} (Duplicate Items: ${duplicateItems.join(", ")})`;
      expect(() => ensureUniqueItemsOrThrow([1, 2, 1], errorMessage)).toThrow(ApiError);
      expect(() => ensureUniqueItemsOrThrow([1, 2, 1], errorMessage)).toThrow(errorMessageFn([1]));

      expect(() => ensureUniqueItemsOrThrow(["a", "b", "a"], errorMessage)).toThrow(ApiError);
      expect(() => ensureUniqueItemsOrThrow(["a", "b", "a"], errorMessage)).toThrow(errorMessageFn(["a"]));

      expect(() => ensureUniqueItemsOrThrow([true, true], errorMessage)).toThrow(ApiError);
      expect(() => ensureUniqueItemsOrThrow([true, true], errorMessage)).toThrow(errorMessageFn([true]));
    });
  });
});
