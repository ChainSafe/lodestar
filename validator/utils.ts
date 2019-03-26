/**
 * Function that loops over an async function until it returns a truthy value.
 * @param {Function} fn - Async function to itterate over
 * @param {object} params - any params for the function.
 * @param {string} inMsg - Log message to be displayed for each loop
 * @param {string} outMsg - Log message to be displayed upon returning a value
 * @returns {T} - returns generic value based fn return.
 */
export async function loop<T>(fn: Function, params: Array, inMsg: string, outMsg: string): T {
  let res: T;
  while (!res) {
    console.log(inMsg);
    res = await fn(...params);
  }
  console.log(outMsg);
  console.log(res);
  return res;
}
