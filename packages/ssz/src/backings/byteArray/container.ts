import {ObjectLike} from "../../interface";
import {ContainerType, CompositeType, Type} from "../../types";
import {ByteArrayHandler} from "./abstract";

export class ContainerByteArrayHandler<T extends ObjectLike> extends ByteArrayHandler<T> {
  _type: ContainerType<T>;
  constructor(type: ContainerType<T>) {
    super();
    this._type = type;
  }
  defaultBacking(): Uint8Array {
    throw new Error("Not implelented");
  }
  getVariableOffsets(target: Uint8Array): [number, number][] {
    const offsets: [number, number][] = [];
    // variable-sized values can be interspersed with fixed-sized values
    // variable-sized value indices are serialized as offsets, indices deeper in the byte array
    let currentIndex = 0;
    let nextIndex = 0;
    const fixedSection = new DataView(target.buffer, target.byteOffset);
    const fixedOffsets: [number, number][] = [];
    const variableOffsets: number[]  = [];
    let variableIndex = 0;
    Object.values(this._type.fields).forEach((fieldType, i) => {
      if (fieldType.isVariableSize()) {
        const offset = fixedSection.getUint32(currentIndex, true);
        if (offset > target.length) {
          throw new Error("Offset out of bounds");
        }
        variableOffsets.push(offset);
        currentIndex = nextIndex = currentIndex + 4;
        variableIndex++;
      } else {
        nextIndex = currentIndex + fieldType.size(null);
        fixedOffsets[i] = [currentIndex, nextIndex];
        currentIndex = nextIndex;
      }
    });
    variableOffsets.push(target.length);
    variableIndex = 0;
    Object.values(this._type.fields).forEach((fieldType, i) => {
      if (fieldType.isVariableSize()) {
        if (variableOffsets[variableIndex] > variableOffsets[variableIndex+1]) {
          throw new Error("Offsets must be increasing");
        }
        offsets.push([variableOffsets[variableIndex], variableOffsets[variableIndex+1]]);
        variableIndex++;
      } else {
        offsets.push(fixedOffsets[i]);
      }
    });
    return offsets;
  }
}
