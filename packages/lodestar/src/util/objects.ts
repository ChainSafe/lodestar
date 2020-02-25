/**
 * @module util/objects
 */
import {Type} from "@chainsafe/ssz";
import {toHexString} from "@chainsafe/ssz";

interface IElementDescription {
  index: number;
  count: number;
}

export function mostFrequent<T>(type: Type<T>, array: T[]): T[] {
  const hashMap: Map<string, IElementDescription> = new Map<string, IElementDescription>();
  array.forEach((e, index) => {
    //We can optimize this by using faster hash like https://github.com/bevacqua/hash-sum
    const hash = toHexString(type.hashTreeRoot(e));

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

export function sszEqualPredicate<T>(type: Type<T>): (a: T, b: T) => boolean {
  return (a: T, b: T) => {
    return type.equals(a, b);
  };
}

export function arrayIntersection<T>(arr1: T[], arr2: T[], predicate: (a: T, b: T) => boolean): T[] {
  return arr1.filter(
    (item1) => {
      return arr2.findIndex((item2) => {
        return predicate(item1, item2);
      }) !== -1;
    }
  );
}
