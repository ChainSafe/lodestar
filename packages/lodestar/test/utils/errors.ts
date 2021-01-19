import {expect} from "chai";
import {LodestarError, mapValues} from "@chainsafe/lodestar-utils";
import {Json} from "@chainsafe/ssz";

export async function expectRejectedWithLodestarError(
  promise: Promise<any>,
  expectedErr: LodestarError<any>
): Promise<void> {
  try {
    const value = await promise;
    const json = JSON.stringify(value, null, 2);
    throw Error(`Expected promise to reject but returned value: \n\n\t${json}`);
  } catch (e) {
    expectLodestarError(e, expectedErr);
  }
}

export function expectLodestarError<T extends {code: string}>(err1: LodestarError<T>, err2: LodestarError<T>): void {
  if (!(err1 instanceof LodestarError)) throw Error(`err1 not instanceof LodestarError: ${(err1 as Error).stack}`);
  if (!(err2 instanceof LodestarError)) throw Error(`err2 not instanceof LodestarError: ${(err2 as Error).stack}`);

  const errMeta1 = getErrorMetadata(err1);
  const errMeta2 = getErrorMetadata(err2);
  expect(errMeta1).to.deep.equal(errMeta2, "Wrong LodestarError metadata");
}

export function getErrorMetadata<T extends {code: string}>(err: LodestarError<T> | Error | Json): Json {
  if (err instanceof LodestarError) {
    return mapValues(err.getMetadata(), (value) => getErrorMetadata(value));
  } else if (err instanceof Error) {
    return err.message;
  } else {
    return err;
  }
}
