import {
  Type,
  BooleanType,
  UintBigintType,
  UintNumberType,
  BitVectorType,
  BitListType,
  ContainerType,
  ListBasicType,
  VectorBasicType,
  VectorCompositeType,
} from "@chainsafe/ssz";

const bool = new BooleanType();
const byte = new UintNumberType(1);
const uint8 = new UintNumberType(1);
const uint16 = new UintNumberType(2);
const uint32 = new UintNumberType(4);
const uint64 = new UintBigintType(8);
const uint128 = new UintBigintType(16);
const uint256 = new UintBigintType(32);

// class SingleFieldTestStruct(Container):
//     A: byte
const SingleFieldTestStruct = new ContainerType({
  A: byte,
});

// class SmallTestStruct(Container):
//     A: uint16
//     B: uint16
const SmallTestStruct = new ContainerType({
  A: uint16,
  B: uint16,
});

// class FixedTestStruct(Container):
//     A: uint8
//     B: uint64
//     C: uint32
const FixedTestStruct = new ContainerType({
  A: uint8,
  B: uint64,
  C: uint32,
});

// class VarTestStruct(Container):
//     A: uint16
//     B: List[uint16, 1024]
//     C: uint8
const VarTestStruct = new ContainerType({
  A: uint16,
  B: new ListBasicType(uint16, 1024),
  C: uint8,
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
  A: uint16,
  B: new ListBasicType(uint16, 128),
  C: uint8,
  D: new BitListType(256),
  E: VarTestStruct,
  F: new VectorCompositeType(FixedTestStruct, 4),
  G: new VectorCompositeType(VarTestStruct, 2),
});

// class BitsStruct(Container):
//     A: Bitlist[5]
//     B: Bitvector[2]
//     C: Bitvector[1]
//     D: Bitlist[6]
//     E: Bitvector[8]
const BitsStruct = new ContainerType({
  A: new BitListType(5),
  B: new BitVectorType(2),
  C: new BitVectorType(1),
  D: new BitListType(6),
  E: new BitVectorType(8),
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
  bool,
  uint8,
  uint16,
  uint32,
  uint64,
  uint128,
  uint256,
};

/**
 * @param testType `"basic_vector" | "bitvector" | "containers"`
 * @param testCase `"vec_bool_1_max" | "bitvec_2_zero"`
 */
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
      return new VectorBasicType(elementType, length);
    }

    // `bitlist_{limit}`
    // {limit}: the list limit, in bits, of the bitlist.
    case "bitlist": {
      // Consider case `bitlist_no_delimiter_empty`
      // Set bitLen to a random big value. 0 is invalid and will throw at the constructor
      const limit = testCase.includes("no_delimiter") ? 1024 : parseSecondNum(testCase, "limit");
      // TODO: memoize
      return new BitListType(limit);
    }

    // `bitvec_{length}`
    // {length}: the length, in bits, of the bitvector.
    case "bitvector": {
      // TODO: memoize
      return new BitVectorType(parseSecondNum(testCase, "length"));
    }

    // A boolean has no type variations. Instead, file names just plainly describe the contents for debugging.
    case "boolean":
      return bool;

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
      return new UintBigintType((parseSecondNum(testCase, "size") / 8) as 8);
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
