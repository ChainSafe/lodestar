/**
 * @module util/objects
 */

function isObjectObject(val: any): boolean {
  return val != null && typeof val === 'object' && Array.isArray(val) === false;
}

export function isPlainObject(o: any): boolean {
  let ctor,prot;

  if (isObjectObject(o) === false) return false;

  // If has modified constructor
  ctor = o.constructor;
  if (typeof ctor !== 'function') return false;

  // If has modified prototype
  prot = ctor.prototype;
  if (isObjectObject(prot) === false) return false;

  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty('isPrototypeOf') === false) {
    return false;
  }

  // Most likely a plain Object
  return true;
}
