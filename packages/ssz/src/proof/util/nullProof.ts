/** @module ssz */
import {GeneralizedIndex, IProofBuilder} from "./types";

export class NullProofBuilder implements IProofBuilder<null> {
  public constructor() {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public add(index: GeneralizedIndex, chunk: Buffer): void {}
  public proof(): null {
    return null;
  }
}

export const nullProofBuilder = new NullProofBuilder();
