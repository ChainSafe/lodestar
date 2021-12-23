import {
  BigIntUintType,
  BitListType,
  BitVectorType,
  booleanType,
  byteType,
  ContainerType,
  ListType,
  Type,
  VectorType,
} from "@chainsafe/ssz";

/* eslint-disable @typescript-eslint/naming-convention */

// class SingleFieldTestStruct(Container):
//     A: byte
const SingleFieldTestStruct = new ContainerType({
  fields: {
    a: byteType,
  },
});

// class SmallTestStruct(Container):
//     A: uint16
//     B: uint16
const SmallTestStruct = new ContainerType({
  fields: {
    a: new BigIntUintType({byteLength: 16 / 8}),
    b: new BigIntUintType({byteLength: 16 / 8}),
  },
});

// class FixedTestStruct(Container):
//     A: uint8
//     B: uint64
//     C: uint32
const FixedTestStruct = new ContainerType({
  fields: {
    a: new BigIntUintType({byteLength: 8 / 8}),
    b: new BigIntUintType({byteLength: 64 / 8}),
    c: new BigIntUintType({byteLength: 32 / 8}),
  },
});

// class VarTestStruct(Container):
//     A: uint16
//     B: List[uint16, 1024]
//     C: uint8
const VarTestStruct = new ContainerType({
  fields: {
    a: new BigIntUintType({byteLength: 16 / 8}),
    b: new ListType({elementType: new BigIntUintType({byteLength: 16 / 8}), limit: 1024}),
    c: new BigIntUintType({byteLength: 8 / 8}),
  },
});

// class ComplexTestStruct(Container):
//     A: uint16
//     B: List[uint16, 128]
//     C: uint8
//     D: Bytes[256]
//     E: VarTestStruct
//     F: Vector[FixedTestStruct, 4]
//     G: Vector[VarTestStruct, 2]
const ComplexTestStruct = new ContainerType({
  fields: {
    a: new BigIntUintType({byteLength: 16 / 8}),
    b: new ListType({elementType: new BigIntUintType({byteLength: 16 / 8}), limit: 128}),
    c: new BigIntUintType({byteLength: 8 / 8}),
    d: new BitListType({limit: 256}),
    e: VarTestStruct,
    f: new VectorType({elementType: FixedTestStruct, length: 4}),
    g: new VectorType({elementType: VarTestStruct, length: 2}),
  },
});

// class BitsStruct(Container):
//     A: Bitlist[5]
//     B: Bitvector[2]
//     C: Bitvector[1]
//     D: Bitlist[6]
//     E: Bitvector[8]
const BitsStruct = new ContainerType({
  fields: {
    a: new BitListType({limit: 5}),
    b: new BitVectorType({length: 2}),
    c: new BitVectorType({length: 1}),
    d: new BitListType({limit: 6}),
    e: new BitVectorType({length: 8}),
  },
});

const containerTypes = {
  SingleFieldTestStruct,
  SmallTestStruct,
  FixedTestStruct,
  VarTestStruct,
  ComplexTestStruct,
  BitsStruct,
};

const vecElementTypes = {
  bool: booleanType,
  uint8: new BigIntUintType({byteLength: 8 / 8}),
  uint16: new BigIntUintType({byteLength: 16 / 8}),
  uint32: new BigIntUintType({byteLength: 32 / 8}),
  uint64: new BigIntUintType({byteLength: 64 / 8}),
  uint128: new BigIntUintType({byteLength: 128 / 8}),
  uint256: new BigIntUintType({byteLength: 256 / 8}),
};

export function getTestType(testType: string, testCase: string): Type<unknown> {
  switch (testType) {
    // `vec_{element type}_{length}`
    // {element type}: bool, uint8, uint16, uint32, uint64, uint128, uint256
    // {length}: an unsigned integer
    case "basic_vector": {
      const match = testCase.match(/vec_([^\W_]+)_([0-9]+)/);
      const [, elementTypeStr, lengthStr] = match || [];
      const elementType = vecElementTypes[elementTypeStr as keyof typeof vecElementTypes];
      if (elementType === undefined) throw Error(`No vecElementType for ${elementTypeStr}: '${testCase}'`);
      const length = parseInt(lengthStr);
      if (isNaN(length)) throw Error(`Bad length ${length}: '${testCase}'`);
      return new VectorType({elementType, length});
    }

    // `bitlist_{limit}`
    // {limit}: the list limit, in bits, of the bitlist.
    case "bitlist": {
      // Consider case `bitlist_no_delimiter_empty`
      const limit = testCase.includes("no_delimiter") ? 0 : parseSecondNum(testCase, "limit");
      // TODO: memoize
      return new BitListType({limit});
    }

    // `bitvec_{length}`
    // {length}: the length, in bits, of the bitvector.
    case "bitvector": {
      // TODO: memoize
      return new BitVectorType({length: parseSecondNum(testCase, "length")});
    }

    // A boolean has no type variations. Instead, file names just plainly describe the contents for debugging.
    case "boolean":
      return booleanType;

    // {container name}
    // {container name}: Any of the container names listed below (excluding the `(Container)` python super type)
    case "containers": {
      const match = testCase.match(/([^\W_]+)/);
      const containerName = (match || [])[1];
      const containerType = containerTypes[containerName as keyof typeof containerTypes];
      if (containerType === undefined) throw Error(`No containerType for ${containerName}`);
      return containerType;
    }

    // `uint_{size}`
    // {size}: the uint size: 8, 16, 32, 64, 128 or 256.
    case "uints": {
      // TODO: memoize
      return new BigIntUintType({byteLength: parseSecondNum(testCase, "size") / 8});
    }

    default:
      throw Error(`Unknown testType ${testType}`);
  }
}

/**
 * Parse second num in a underscore string: `uint_8_`, returns 8
 */
function parseSecondNum(str: string, id: string): number {
  const match = str.match(/[^\W_]+_([0-9]+)/);
  const num = parseInt((match || [])[1]);
  if (isNaN(num)) throw Error(`Bad ${id} ${str}`);
  return num;
}
