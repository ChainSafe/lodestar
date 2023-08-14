import {expect} from "chai";

export function expectDeepEquals<T>(a: T, b: T, message?: string): void {
  expect(a).deep.equals(b, message);
}

export function expectEquals<T>(a: T, b: T, message?: string): void {
  expect(a).equals(b, message);
}
