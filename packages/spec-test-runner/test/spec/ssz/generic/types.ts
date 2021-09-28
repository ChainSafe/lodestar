/* eslint-disable @typescript-eslint/naming-convention */
import {SPEC_TEST_LOCATION} from "../../../specTestVersioning";
import {join} from "path";
import {
  BigIntUintType,
  BitListType,
  BitVectorType,
  booleanType,
  // byteType,
  ContainerType,
  ListType,
  Type,
  VectorType,
} from "@chainsafe/ssz";

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
const containerPath = join(rootGenericSszPath, "containers");

const FixedTestStruct = new ContainerType({
  fields: {
    a: new BigIntUintType({byteLength: 1}),
    b: new BigIntUintType({byteLength: 8}),
    c: new BigIntUintType({byteLength: 4}),
  },
});
const VarTestStruct = new ContainerType({
  fields: {
    a: new BigIntUintType({byteLength: 2}),
    b: new ListType({
      elementType: new BigIntUintType({byteLength: 2}),
      limit: 1024,
    }),
    c: new BigIntUintType({byteLength: 1}),
  },
});

const containerTypes: IGenericSSZType<any>[] = [
  {
    type: new ContainerType({
      fields: {
        a: new BigIntUintType({byteLength: 1}),
      },
    }),
    prefix: "SingleFieldTestStruct",
    path: containerPath,
  },
  {
    type: new ContainerType({
      fields: {
        a: new BigIntUintType({byteLength: 2}),
        b: new BigIntUintType({byteLength: 2}),
      },
    }),
    prefix: "SmallTestStruct",
    path: containerPath,
  },
  {
    type: FixedTestStruct,
    prefix: "FixedTestStruct",
    path: containerPath,
  },
  {
    type: VarTestStruct,
    prefix: "VarTestStruct",
    path: containerPath,
  },
  /* TODO implement ByteList
  {
    type: new ContainerType({
      fields: {
        a: new BigIntUintType({byteLength: 2}),
        b: new ListType({
          elementType: new BigIntUintType({byteLength: 2}),
          limit: 128,
        }),
        c: new BigIntUintType({byteLength: 1}),
        d: new ListType({
          elementType: byteType,
          limit: 256,
        }),
        e: VarTestStruct,
        f: new VectorType({
          elementType: FixedTestStruct,
          length: 4,
        }),
        g: new VectorType({
          elementType: VarTestStruct,
          length: 2,
        }),
      },
    }),
    prefix: "ComplexTestStruct",
    path: containerPath,
  },
  */
  {
    type: new ContainerType({
      fields: {
        a: new BitListType({limit: 5}),
        b: new BitVectorType({length: 2}),
        c: new BitVectorType({length: 1}),
        d: new BitListType({limit: 6}),
        e: new BitVectorType({length: 8}),
      },
    }),
    prefix: "BitsStruct",
    path: containerPath,
  },
];

export const types: IGenericSSZType<any>[] = (boolTypes as IGenericSSZType<any>[]).concat(
  uintTypes,
  basicVectorTypes,
  bitvectorTypes,
  bitlistTypes,
  containerTypes
);
