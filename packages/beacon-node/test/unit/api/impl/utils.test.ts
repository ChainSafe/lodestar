import {describe, expect, it} from "vitest";
import {ApiError} from "../../../../src/api/impl/errors.js";
import {assertUniqueItems} from "../../../../src/api/impl/utils.js";

describe("api / impl / utils", () => {
  describe("assertUniqueItems", () => {
    it("should not throw for undefined input", () => {
      expect(() => assertUniqueItems(undefined, "test message")).not.toThrow();
    });

    it("should not throw for empty array", () => {
      expect(() => assertUniqueItems([], "test message")).not.toThrow();
    });

    it("should not throw for array with unique values", () => {
      expect(() => assertUniqueItems([1, 2, 3], "test message")).not.toThrow();
      expect(() => assertUniqueItems(["a", "b", "c"], "test message")).not.toThrow();
      expect(() => assertUniqueItems([true, false], "test message")).not.toThrow();
    });

    it("should throw ApiError if array contains duplicate values", () => {
      expect(() => assertUniqueItems([1, 2, 1], "Duplicate values found")).toThrowError(ApiError);
    });

    it("should throw if array contains duplicate values and list duplicates", () => {
      const errorMessage = "Duplicate values found";
      const errorMessageFn = (duplicateItems: unknown[]) => `${errorMessage}: ${duplicateItems.join(", ")}`;

      expect(() => assertUniqueItems([1, 2, 1], errorMessage)).toThrow(errorMessageFn([1]));
      expect(() => assertUniqueItems([1, 2, 1, 2], errorMessage)).toThrow(errorMessageFn([1, 2]));
      expect(() => assertUniqueItems(["a", "b", "a"], errorMessage)).toThrow(errorMessageFn(["a"]));
      expect(() => assertUniqueItems([true, true], errorMessage)).toThrow(errorMessageFn([true]));
    });
  });
});
