// eslint-disable-next-line import/no-extraneous-dependencies
import {expect} from "vitest";

expect.extend({
  toBeValidEpochCommittee: (
    committee: {index: number; slot: number; validators: unknown[]},
    {
      committeeCount,
      validatorsPerCommittee,
      slotsPerEpoch,
    }: {committeeCount: number; validatorsPerCommittee: number; slotsPerEpoch: number}
  ) => {
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
  toBeWithMessage: (received: unknown, expected: unknown, message: string) => {
    if (received === expected) {
      return {
        message: () => "Expected value is truthy",
        pass: true,
      };
    }

    return {
      pass: false,
      message: () => message,
    };
  },
  toSatisfy: (received: unknown, func: (received: unknown) => boolean) => {
    if (func(received)) {
      return {
        message: () => "Expected value satisfied the condition",
        pass: true,
      };
    }

    return {
      pass: false,
      message: () => "Expected value did not satisfy the condition",
    };
  },
});
