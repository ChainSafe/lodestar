/* eslint-disable @typescript-eslint/no-explicit-any */
export type GetInstanceFunc<T> = (...args: any[]) => Promise<T|null>;

export async function retryable<T>(
  funcGen: Generator<GetInstanceFunc<T>> | GetInstanceFunc<T>,
  retry = 3): Promise<T|null> {
  let result: T;
  let count = 0;
  while(!result && count < retry) {
    const func = (funcGen as Generator).next? (funcGen as Generator).next().value : funcGen as GetInstanceFunc<T>;
    result = await func();
    count++;
  }
  return result;
}