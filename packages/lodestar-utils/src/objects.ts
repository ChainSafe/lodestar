/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {toExpectedCase} from "@chainsafe/ssz/lib/backings/utils";

/**
 * @module objects
 */

function isObjectObject(val: unknown): boolean {
  return val != null && typeof val === "object" && Array.isArray(val) === false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPlainObject(o: any): boolean {
  if (isObjectObject(o) === false) return false;

  // If has modified constructor
  const ctor = o.constructor;
  if (typeof ctor !== "function") return false;

  // If has modified prototype
  const prot = ctor.prototype;
  if (isObjectObject(prot) === false) return false;

  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty("isPrototypeOf") === false) {
    return false;
  }

  // Most likely a plain Object
  return true;
}

export function mapValues<T, R>(obj: {[key: string]: T}, iteratee: (value: T, key: string) => R): {[key: string]: R} {
  const output: {[key: string]: R} = {};
  for (const [key, value] of Object.entries(obj)) {
    output[key] = iteratee(value, key);
  }
  return output;
}

export function objectToExpectedCase(
  obj: Record<string, unknown>,
  expectedCase: "snake" | "camel" = "camel"
): Record<string, unknown> {
  if (Array.isArray(obj)) {
    const newArr: unknown[] = [];
    for (let i = 0; i < obj.length; i++) {
      newArr[i] = objectToExpectedCase(obj[i], expectedCase);
    }
    return (newArr as unknown) as Record<string, unknown>;
  }

  if (Object(obj) === obj) {
    const newObj: Record<string, unknown> = {};
    for (const name of Object.getOwnPropertyNames(obj)) {
      const newName = toExpectedCase(name, expectedCase);
      if (newName !== name && obj.hasOwnProperty(newName)) {
        throw new Error(`object already has a ${newName} property`);
      }

      newObj[newName] = objectToExpectedCase(obj[name] as Record<string, unknown>, expectedCase);
    }
    return newObj;
  }

  return obj;
}
