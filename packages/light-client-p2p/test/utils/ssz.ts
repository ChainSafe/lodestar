import {expect} from "chai";

type Type = {equals: (a: any, b: any) => boolean};

/**
 * Helper to type calling `type.equals` with a union of SSZ types
 */
export function isEqualSszType<T>(type: Type, a: T, b: T): boolean {
  return type.equals(a, b);
}

export function expectIsEqualSszTypeArr<T>(type: Type | Type[], arrA: T[], arrB: T[], message?: string): void {
  expect(arrA).to.have.length(arrB.length, "Array don't have the same length");

  for (let i = 0; i < arrA.length; i++) {
    const itemType = Array.isArray(type) ? type[i] : type;
    const a = arrA[i];
    const b = arrB[i];
    expect(a, `arrA[${i}] is not defined`).to.not.be.undefined;
    expect(b, `arrB[${i}] is not defined`).to.not.be.undefined;
    expect(itemType.equals(a, b)).to.equal(true, `${message || "Items"} [${i}] SSZ type is not equal`);
  }
}
