import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {join} from "path";
import {BigIntUintType, BitListType, BitVectorType, booleanType, Type, VectorType} from "@chainsafe/ssz";

const rootGenericSszPath = join(SPEC_TEST_LOCATION, "tests", "general", "phase0", "ssz_generic");

export interface IGenericSSZType<T> {
  type: Type<T>;
  path: string;
  prefix: string;
}

// boolean

const booleanPath = join(rootGenericSszPath, "boolean");

const boolTypes = [
  {
    type: booleanType,
    prefix: "true",
    path: booleanPath,
  },
  {
    type: booleanType,
    prefix: "false",
    path: booleanPath,
  },
];

// used for basic vector
const boolTypes2 = [
  {
    type: booleanType,
    prefix: "bool",
    path: booleanPath,
  },
];

// uints

const uintsPath = join(rootGenericSszPath, "uints");

const uintTypes = [
  {
    type: new BigIntUintType({byteLength: 1}),
    prefix: "uint_8",
    path: uintsPath,
  },
  {
    type: new BigIntUintType({byteLength: 2}),
    prefix: "uint_16",
    path: uintsPath,
  },
  {
    type: new BigIntUintType({byteLength: 4}),
    prefix: "uint_32",
    path: uintsPath,
  },
  {
    type: new BigIntUintType({byteLength: 8}),
    prefix: "uint_64",
    path: uintsPath,
  },
  {
    type: new BigIntUintType({byteLength: 16}),
    prefix: "uint_128",
    path: uintsPath,
  },
  {
    type: new BigIntUintType({byteLength: 32}),
    prefix: "uint_256",
    path: uintsPath,
  },
];

// used for basic vector
const uintTypes2 = uintTypes.map((t) => {
  return {
    ...t,
    prefix: t.prefix.replace("_", ""),
  };
});

const lengths = [1, 2, 3, 4, 5, 8, 16, 31, 512, 513];

// basic_vector
const basicVectorPath = join(rootGenericSszPath, "basic_vector");
const basicVectorTypes = (boolTypes2 as IGenericSSZType<any>[])
  .concat(uintTypes2)
  .map((t) => {
    return lengths.map((length) => {
      return {
        type: new VectorType({
          elementType: t.type,
          length,
        }),
        prefix: `vec_${t.prefix}_${length}_`,
        path: basicVectorPath,
      };
    });
  })
  .flat(1);

// bitlist
const bitlistPath = join(rootGenericSszPath, "bitlist");
const bitlistTypes = lengths.map((length) => {
  return {
    type: new BitListType({
      limit: length,
    }),
    prefix: `bitlist_${length}_`,
    path: bitlistPath,
  };
});

// bitvector
const bitvectorPath = join(rootGenericSszPath, "bitvector");
const bitvectorTypes = lengths.map((length) => {
  return {
    type: new BitVectorType({
      length,
    }),
    prefix: `bitvec_${length}_`,
    path: bitvectorPath,
  };
});

// containers
// const containerPath = join(rootGenericSszPath, "containers");
const containerTypes: IGenericSSZType<any>[] = [];

export const types: IGenericSSZType<any>[] = (boolTypes as IGenericSSZType<any>[]).concat(
  uintTypes,
  basicVectorTypes,
  bitvectorTypes,
  bitlistTypes,
  containerTypes
);
