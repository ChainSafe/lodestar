// eslint-disable-next-line import/default
import camelcase from "camelcase";

export function objectToCamelCase(obj: object): object {
  if (Object(obj) === obj) {
    Object.getOwnPropertyNames(obj).forEach((name) => {
      const newName = camelcase(name);
      if (newName !== name) {
        // @ts-ignore
        if (obj.hasOwnProperty(newName)) {
          throw new Error(`object already has a ${newName} property`);
        }
        // @ts-ignore
        obj[newName] = obj[name];
        // @ts-ignore
        delete obj[name];
      }
      // @ts-ignore
      objectToCamelCase(obj[newName]);
    });
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      obj[i] = objectToCamelCase(obj[i]);
    }
  }
  return obj;
}
