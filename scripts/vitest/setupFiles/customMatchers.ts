import {expect} from "vitest";
import {LodestarError} from "@lodestar/utils";

expect.extend({
  toBeValidEpochCommittee(
    committee: {index: number; slot: number; validators: unknown[]},
    {
      committeeCount,
      validatorsPerCommittee,
      slotsPerEpoch,
    }: {committeeCount: number; validatorsPerCommittee: number; slotsPerEpoch: number}
  ) {
    if (committee.index < 0 || committee.index > committeeCount - 1) {
      return {
        message: () =>
          `Committee index out of range. Expected between 0-${committeeCount - 1}, but got ${committee.index}`,
        pass: false,
      };
    }

    if (committee.slot < 0 || committee.slot > slotsPerEpoch - 1) {
      return {
        message: () =>
          `Committee slot out of range. Expected between 0-${slotsPerEpoch - 1}, but got ${committee.slot}`,
        pass: false,
      };
    }

    if (committee.validators.length !== validatorsPerCommittee) {
      return {
        message: () =>
          `Incorrect number of validators in committee. Expected ${validatorsPerCommittee}, but got ${committee.validators.length}`,
        pass: false,
      };
    }

    return {
      message: () => "Committee is valid",
      pass: true,
    };
  },
  toBeWithMessage(received: unknown, expected: unknown, message: string) {
    if (Object.is(received, expected)) {
      return {
        message: () => "Received value is the same as expected value",
        pass: true,
      };
    }

    return {
      pass: false,
      message: () => message,
      actual: received,
      expected,
    };
  },
  toSatisfy(received: unknown, func: (received: unknown) => boolean) {
    if (func(received)) {
      return {
        message: () => "Received value satisfied the condition",
        pass: true,
      };
    }

    return {
      pass: false,
      message: () => "Received value did not satisfy the condition",
    };
  },
  toEqualWithMessage(received: unknown, expected: unknown, message: string) {
    if (this.equals(received, expected)) {
      return {
        message: () => "Received value equals expected value",
        pass: true,
      };
    }

    return {
      pass: false,
      message: () => message,
      actual: received,
      expected,
    };
  },
  toThrowLodestarError<T extends {code: string}>(received: Function, expected: T, message?: string) {
    try {
      received();

      return {
        pass: false,
        message: () => "Received value did not throw any error",
      };
    } catch (error) {      
      if (!(error instanceof LodestarError)) {
        return {
          message: () => "Received value did not throw LodestarError",
          pass: false,
          actual: error,
          expected: LodestarError,
        };
      }
      const errorMeta = (error as unknown as LodestarError<T>).getMetadata();
      const errorMessage = (error as unknown as LodestarError<T>).message;

      if (this.equals(errorMeta, expected)) {
        if(message && errorMessage !== message) {
          return {
            message: () => "Received value error message does not match",
            pass: false,
            actual: errorMessage,
            expected: message,
          };
        }

        return {
          message: () => "Received value threw valid error",
          pass: true,
        };
      }

      return {
        message: () => `Received error does not match. Expected ${expected.code}, but got ${(error as unknown as LodestarError<T>).type.code}`,
        pass: false,
        actual: errorMeta,
        expected: expected
      };
    }
  }
});
