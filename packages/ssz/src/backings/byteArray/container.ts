import {ObjectLike} from "../../interface";
import {ContainerType, CompositeType, Type} from "../../types";
import {ByteArrayHandler, ByteArrayBacking} from "./abstract";

export class ContainerByteArrayHandler<T extends ObjectLike> extends ByteArrayHandler<T> {
  _type: ContainerType<T>;
  constructor(type: ContainerType<T>) {
    super();
    this._type = type;
  }
  defaultBacking(): ByteArrayBacking {
    throw new Error("Not implelented");
  }
  getVariableOffsets(target: ByteArrayBacking): [number, number][] {
    const offsets: [number, number][] = [];
    // variable-sized values can be interspersed with fixed-sized values
    // variable-sized value indices are serialized as offsets, indices deeper in the byte array
    let currentIndex = 0;
    let nextIndex = 0;
    let currentOffset = 0;
    let nextOffset = 0;
    const fieldCount = this._type.fields.length;
    const fixedSection = new DataView(target.buffer, target.byteOffset);
    this._type.fields.forEach(([_, fieldType], i) => {
      if (fieldType.isVariableSize()) {
        nextIndex = currentIndex + 4;
        nextOffset = i === fieldCount - 1
          ? target.length
          : fixedSection.getUint32(nextIndex, true);
        if (nextOffset > target.length) {
          throw new Error("Offset out of bounds");
        }
        if (currentOffset > nextOffset) {
          throw new Error("Offsets must be increasing");
        }
        offsets.push([currentOffset, nextOffset]);
        currentOffset = nextOffset;
        currentIndex = nextIndex;
      } else {
        nextIndex = currentIndex + fieldType.size(null);
        offsets.push([currentIndex, nextIndex]);
        currentIndex = nextIndex;
      }
    });
    return offsets;
  }
}
