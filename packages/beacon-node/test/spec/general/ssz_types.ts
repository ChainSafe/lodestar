import {
  BitListType,
  BitVectorType,
  BooleanType,
  ByteListType,
  ByteVectorType,
  CompatibleUnionType,
  ContainerType,
  ListBasicType,
  ListCompositeType,
  ProgressiveBitListType,
  ProgressiveContainerType,
  ProgressiveListBasicType,
  ProgressiveListCompositeType,
  Type,
  UintBigintType,
  UintNumberType,
  VectorBasicType,
} from "@chainsafe/ssz";

const boolean = new BooleanType();
const uint8 = new UintNumberType(1);
const uint16 = new UintNumberType(2);
const uint32 = new UintNumberType(4);
const uint64 = new UintBigintType(8);
const uint128 = new UintBigintType(16);
const uint256 = new UintBigintType(32);

const bytes4 = new ByteVectorType(4);
const bytes32 = new ByteVectorType(32);
const bytes52 = new ByteVectorType(52);
const bytes64 = new ByteVectorType(64);

const sampleUint16List4 = new ListBasicType(uint16, 4);
const sampleUint64ProgressiveList = new ProgressiveListBasicType(uint64);
const sampleSquare = new ProgressiveContainerType({side: uint16, color: uint8}, [true, false, true]);
const sampleCircle = new ProgressiveContainerType({radius: uint16, color: uint8}, [false, true, true]);

const sampleShape = new CompatibleUnionType({1: sampleSquare, 2: sampleCircle, 127: sampleSquare});
const sampleNumbers = new CompatibleUnionType({1: sampleUint16List4, 2: sampleUint16List4});
const sampleSquareProgressiveList = new ProgressiveListCompositeType(sampleSquare);
const sampleCircleProgressiveList = new ProgressiveListCompositeType(sampleCircle);
const sampleEmptyProne = new CompatibleUnionType({
  1: sampleSquareProgressiveList,
  2: sampleCircleProgressiveList,
});
const sampleSquareOnly = new CompatibleUnionType({5: sampleSquare});
const sampleNestedShape = new CompatibleUnionType({1: sampleShape, 2: sampleSquareOnly});

const basicTypes: Record<string, Type<unknown>> = {
  Boolean: boolean,
  Uint8: uint8,
  Uint16: uint16,
  Uint32: uint32,
  Uint64: uint64,
  Uint128: uint128,
  Uint256: uint256,
  Bytes4: bytes4,
  Bytes32: bytes32,
  Bytes52: bytes52,
  Bytes64: bytes64,
  ByteList512KiB: new ByteListType(512 * 1024),
  SampleBitVector8: new BitVectorType(8),
  SampleBitVector64: new BitVectorType(64),
  SampleBitList16: new BitListType(16),
  SampleUint16Vector3: new VectorBasicType(uint16, 3),
  SampleUint64Vector4: new VectorBasicType(uint64, 4),
  SampleUint32List16: new ListBasicType(uint32, 16),
  SampleBytes32List8: new ListCompositeType(bytes32, 8),
};

const compatibleUnionTypes: Record<string, Type<unknown>> = {
  SampleShape: sampleShape,
  SampleNumbers: sampleNumbers,
  SampleEmptyProne: sampleEmptyProne,
  SampleNestedShape: sampleNestedShape,
  SampleShapeContainer: new ContainerType({tag: uint64, body: sampleShape}),
  SampleShapeProgressiveContainer: new ProgressiveContainerType({tag: uint64, body: sampleShape}, [true, false, true]),
  SampleShapeProgressiveList: new ProgressiveListCompositeType(sampleShape),
};

const boundaryTypes: Record<string, Type<unknown>> = {
  BoundaryBitVector1: new BitVectorType(1),
  BoundaryBitVector7: new BitVectorType(7),
  BoundaryBitVector9: new BitVectorType(9),
  BoundaryBitVector255: new BitVectorType(255),
  BoundaryBitVector256: new BitVectorType(256),
  BoundaryBitVector257: new BitVectorType(257),
  BoundaryBitList256: new BitListType(256),
  BoundaryUint64List32: new ListBasicType(uint64, 32),
};

const sampleInnerShape = new ProgressiveContainerType({x: uint16, y: uint8}, [true, false, true]);
const progressiveContainerTypes: Record<string, Type<unknown>> = {
  SampleSquare: sampleSquare,
  SampleCircle: sampleCircle,
  SampleOneField: new ProgressiveContainerType({a: uint16}, [true]),
  SampleLeadingGaps: new ProgressiveContainerType({c: uint32}, [false, false, true]),
  SampleMultipleGaps: new ProgressiveContainerType({a: uint8, b: uint16, c: uint32}, [
    true,
    false,
    false,
    true,
    false,
    true,
  ]),
  SampleWidestLayout: new ProgressiveContainerType({tail: uint8}, [...Array(255).fill(false), true]),
  SampleLevelBoundary: new ProgressiveContainerType({first: uint16, last: uint8}, [
    true,
    ...Array(20).fill(false),
    true,
  ]),
  SampleBoundedListField: new ProgressiveContainerType({head: uint64, body: sampleUint16List4}, [true, false, true]),
  SampleProgressiveFields: new ProgressiveContainerType(
    {head: uint64, numbers: sampleUint64ProgressiveList, flags: new ProgressiveBitListType()},
    [true, true, true]
  ),
  SampleOuterShape: new ProgressiveContainerType({head: uint8, inner: sampleInnerShape}, [true, false, true]),
  SampleSquareProgressiveList: sampleSquareProgressiveList,
  SampleShapeContainer: new ContainerType({tag: uint8, shape: sampleSquare}),
};

const sampleUint16ProgressiveList = new ProgressiveListBasicType(uint16);
const progressiveTypes: Record<string, Type<unknown>> = {
  SampleUint64ProgressiveList: sampleUint64ProgressiveList,
  SampleBytes32ProgressiveList: new ProgressiveListCompositeType(bytes32),
  SampleNestedProgressiveList: new ProgressiveListCompositeType(sampleUint16ProgressiveList),
  ProgressiveBitList: new ProgressiveBitListType(),
  SampleContainerWithProgressiveList: new ContainerType({
    a: uint16,
    b: sampleUint64ProgressiveList,
    c: uint8,
  }),
};

const typesBySuite: Record<string, Record<string, Type<unknown>>> = {
  test_basic_types: basicTypes,
  test_compatible_unions: compatibleUnionTypes,
  test_decode_failure_smoke: {SmokeBitList8: new BitListType(8)},
  test_merkleization_boundaries: boundaryTypes,
  test_progressive_containers: progressiveContainerTypes,
  test_progressive_types: progressiveTypes,
};

export function getSszSpecTestType(testSuite: string, typeName: string): Type<unknown> {
  const suiteTypes = typesBySuite[testSuite];
  if (suiteTypes === undefined) {
    throw Error(`Unknown SSZ test suite ${testSuite}`);
  }

  const type = suiteTypes[typeName];
  if (type === undefined) {
    throw Error(`Unknown SSZ type ${typeName} in ${testSuite}`);
  }

  return type;
}
