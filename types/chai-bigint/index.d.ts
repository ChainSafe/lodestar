/// <reference types="chai" />

declare global {
  export namespace Chai {
    interface NumberComparer {
      // Original
      // (value: number | Date, message?: string): Assertion;

      // In our code base we have comparisons with BigInt as well
      (value: number | Date | bigint, message?: string): Assertion;
    }
  }
}

declare const chaiBigInt: Chai.ChaiPlugin;
declare namespace chaiBigInt {}
export = chaiBigInt;
