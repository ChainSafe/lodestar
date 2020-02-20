/* eslint-disable @typescript-eslint/no-unused-vars */
import {ArrayLike} from "../../interface";
import {BasicArrayType, CompositeArrayType} from "../../types";
import {ByteArrayHandler} from "./abstract";

export class BasicArrayByteArrayHandler<T extends ArrayLike<unknown>> extends ByteArrayHandler<T> {
  _type: BasicArrayType<T>;
  getLength(target: Uint8Array): number {
    throw new Error("Not implemented");
  }
  chunk(target: Uint8Array, index: number): Uint8Array {
    throw new Error("Not implemented");
  }
}

export class CompositeArrayByteArrayHandler<T extends ArrayLike<unknown>> extends ByteArrayHandler<T> {
  _type: CompositeArrayType<T>;
  getLength(target: Uint8Array): number {
    throw new Error("Not implemented");
  }
  chunk(target: Uint8Array, index: number): Uint8Array {
    throw new Error("Not implemented");
  }
  getVariableOffsets(target: Uint8Array): [number, number][] {
    if (this._type.elementType.isVariableSize()) {
      if (target.length === 0) {
        return [];
      }
      const offsets: [number, number][] = [];
      // all elements are variable-sized
      // indices contain offsets, which are indices deeper in the byte array
      const fixedSection = new DataView(target.buffer, target.byteOffset);
      const firstOffset = fixedSection.getUint32(0, true);
      let currentOffset = firstOffset;
      let nextOffset = currentOffset;
      let currentIndex = 0;
      let nextIndex = 0;
      while (currentIndex < firstOffset) {
        if (currentOffset > target.length) {
          throw new Error("Offset out of bounds");
        }
        nextIndex = currentIndex + 4;
        nextOffset = nextIndex === firstOffset
          ? target.length
          : fixedSection.getUint32(nextIndex, true);
        if (currentOffset > nextOffset) {
          throw new Error("Offsets must be increasing");
        }
        offsets.push([currentOffset, nextOffset]);
        currentIndex = nextIndex;
        currentOffset = nextOffset;
      }
      if (firstOffset !== currentIndex) {
        throw new Error("First offset skips variable data");
      }
      return offsets;
    } else {
      return [];
    }
  }
}



