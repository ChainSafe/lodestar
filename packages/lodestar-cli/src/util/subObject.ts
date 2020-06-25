/* eslint-disable @typescript-eslint/no-explicit-any */
// get / set a sub-object
//
// eg:
//   getSubObject(obj, ["foo", "bar", "baz"]) is obj["foo"]["bar"]["baz"]
//
//   setSubObject(obj, ["foo", "bar", "baz"], value) is obj["foo"]["bar"]["baz"] = value

/**
 * Get sub-object obj[path[0]]...[path[N]]
 */
export function getSubObject(obj: any, path: string[]): any {
  if (path.length === 0) {
    return undefined;
  }
  const key = path[0];
  if (path.length === 1) {
    return obj[key];
  } else {
    if (obj[key] === undefined) {
      return undefined;
    }
    return getSubObject(obj[key], path.slice(1));
  }
}

/**
 * Update sub-object obj[path[0]]...[path[N]] with value
 */
export function setSubObject(obj: any, path: string[], value: any): void {
  if (path.length === 0) {
    return;
  }
  const key = path[0];
  if (path.length === 1) {
    obj[key] = value;
  } else {
    if (obj[key] === undefined) {
      obj[key] = {};
    }
    setSubObject(obj[key], path.slice(1), value);
  }
}
