import {toExpectedCase} from "@chainsafe/ssz/lib/backings/utils";

export function objectToExpectedCase(obj: Record<string, unknown>, expectedCase: "snake"|"camel" = "camel"): object {
  if (Object(obj) === obj) {
    Object.getOwnPropertyNames(obj).forEach((name) => {
      const newName = toExpectedCase(name, expectedCase);
      if (newName !== name) {
        if (obj.hasOwnProperty(newName)) {
          throw new Error(`object already has a ${newName} property`);
        }
        obj[newName] = obj[name];
        delete obj[name];
      }
      objectToExpectedCase(obj[newName] as Record<string, unknown>, expectedCase);
    });
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = objectToExpectedCase(obj[i], expectedCase);
    }
  }
  return obj;
}
