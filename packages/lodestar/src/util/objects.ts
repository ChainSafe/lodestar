/**
 * @module util/objects
 */
import {AnySSZType, hashTreeRoot} from "@chainsafe/ssz";

function isObjectObject(val: unknown): boolean {
  return val != null && typeof val === "object" && Array.isArray(val) === false;
}

export function isPlainObject(o: Record<string, unknown>): boolean {

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

interface IElementDescription {
  index: number;
  count: number;
}

export function mostFrequent<T>(array: T[], type: AnySSZType): T[] {
  const hashMap: Map<string, IElementDescription> = new Map<string, IElementDescription>();
  array.forEach((e, index) => {
    //We can optimize this by using faster hash like https://github.com/bevacqua/hash-sum
    const hash = hashTreeRoot(e, type).toString("hex");

    const desc = hashMap.get(hash);
    if(desc) {
      desc.count++;
      hashMap.set(hash, desc);
    } else {
      hashMap.set(hash, {count: 1, index});
    }
  });
  let max = 0;
  let results: T[] = [];
  for(const elem of hashMap.values()) {
    if(elem.count > max) {
      max = elem.count;
      results = [array[elem.index]];
    } else if(elem.count === max) {
      results.push(array[elem.index]);
    }
  }
  return results;
}
