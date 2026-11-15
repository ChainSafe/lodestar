//! Schemas for the ethereum/ssz-specs JSON fixtures, mirroring `tests/fillers/ssz/` at the pinned
//! fixture version. Suites get separate namespaces because `SampleShapeContainer` differs between
//! suites.

const ssz = @import("ssz");

const Uint8 = ssz.UintType(8);
const Uint16 = ssz.UintType(16);
const Uint32 = ssz.UintType(32);
const Uint64 = ssz.UintType(64);
const Bytes32 = ssz.ByteVectorType(32);
const Uint16List4 = ssz.FixedListType(Uint16, 4, .{});
const Uint64ProgressiveList = ssz.FixedProgressiveListType(Uint64, .{});
const Square = ssz.FixedProgressiveContainerType(struct { side: Uint16, color: Uint8 }, &.{ 1, 0, 1 });
const Circle = ssz.FixedProgressiveContainerType(struct { radius: Uint16, color: Uint8 }, &.{ 0, 1, 1 });
const SquareList = ssz.FixedProgressiveListType(Square, .{});
const CircleList = ssz.FixedProgressiveListType(Circle, .{});
const Shape = ssz.CompatibleUnionType(.{ .{ 1, Square }, .{ 2, Circle }, .{ 127, Square } });

pub const test_basic_types = struct {
    pub const Boolean = ssz.BoolType();
    pub const Uint8 = ssz.UintType(8);
    pub const Uint16 = ssz.UintType(16);
    pub const Uint32 = ssz.UintType(32);
    pub const Uint64 = ssz.UintType(64);
    pub const Uint128 = ssz.UintType(128);
    pub const Uint256 = ssz.UintType(256);
    pub const Bytes4 = ssz.ByteVectorType(4);
    pub const Bytes32 = ssz.ByteVectorType(32);
    pub const Bytes52 = ssz.ByteVectorType(52);
    pub const Bytes64 = ssz.ByteVectorType(64);
    pub const ByteList512KiB = ssz.ByteListType(512 * 1024);
    pub const SampleBitVector8 = ssz.BitVectorType(8);
    pub const SampleBitVector64 = ssz.BitVectorType(64);
    pub const SampleBitList16 = ssz.BitListType(16);
    pub const SampleUint16Vector3 = ssz.FixedVectorType(ssz.UintType(16), 3, .{});
    pub const SampleUint64Vector4 = ssz.FixedVectorType(ssz.UintType(64), 4, .{});
    pub const SampleUint32List16 = ssz.FixedListType(ssz.UintType(32), 16, .{});
    pub const SampleBytes32List8 = ssz.FixedListType(ssz.ByteVectorType(32), 8, .{});
};

pub const test_compatible_unions = struct {
    pub const SampleShape = Shape;
    pub const SampleNumbers = ssz.CompatibleUnionType(.{ .{ 1, Uint16List4 }, .{ 2, Uint16List4 } });
    pub const SampleEmptyProne = ssz.CompatibleUnionType(.{ .{ 1, SquareList }, .{ 2, CircleList } });
    pub const SampleNestedShape = ssz.CompatibleUnionType(.{
        .{ 1, Shape },
        .{ 2, ssz.CompatibleUnionType(.{.{ 5, Square }}) },
    });
    pub const SampleShapeContainer = ssz.VariableContainerType(struct { tag: Uint64, body: Shape });
    pub const SampleShapeProgressiveContainer = ssz.VariableProgressiveContainerType(
        struct { tag: Uint64, body: Shape },
        &.{ 1, 0, 1 },
    );
    pub const SampleShapeProgressiveList = ssz.VariableProgressiveListType(Shape, .{});
};

pub const test_decode_failure_smoke = struct {
    pub const SmokeBitList8 = ssz.BitListType(8);
};

pub const test_merkleization_boundaries = struct {
    pub const BoundaryBitVector1 = ssz.BitVectorType(1);
    pub const BoundaryBitVector7 = ssz.BitVectorType(7);
    pub const BoundaryBitVector9 = ssz.BitVectorType(9);
    pub const BoundaryBitVector255 = ssz.BitVectorType(255);
    pub const BoundaryBitVector256 = ssz.BitVectorType(256);
    pub const BoundaryBitVector257 = ssz.BitVectorType(257);
    pub const BoundaryBitList256 = ssz.BitListType(256);
    pub const BoundaryUint64List32 = ssz.FixedListType(Uint64, 32, .{});
};

pub const test_progressive_containers = struct {
    pub const SampleSquare = Square;
    pub const SampleCircle = Circle;
    pub const SampleOneField = ssz.FixedProgressiveContainerType(struct { a: Uint16 }, &.{1});
    pub const SampleLeadingGaps = ssz.FixedProgressiveContainerType(struct { c: Uint32 }, &.{ 0, 0, 1 });
    pub const SampleMultipleGaps = ssz.FixedProgressiveContainerType(struct { a: Uint8, b: Uint16, c: Uint32 }, &.{ 1, 0, 0, 1, 0, 1 });
    pub const SampleWidestLayout = ssz.FixedProgressiveContainerType(struct { tail: Uint8 }, &([_]u1{0} ** 255 ++ [_]u1{1}));
    pub const SampleLevelBoundary = ssz.FixedProgressiveContainerType(struct { first: Uint16, last: Uint8 }, &([_]u1{1} ++ [_]u1{0} ** 20 ++ [_]u1{1}));
    pub const SampleBoundedListField = ssz.VariableProgressiveContainerType(struct { head: Uint64, body: Uint16List4 }, &.{ 1, 0, 1 });
    pub const SampleProgressiveFields = ssz.VariableProgressiveContainerType(struct { head: Uint64, numbers: Uint64ProgressiveList, flags: ssz.ProgressiveBitListType(.{}) }, &.{ 1, 1, 1 });
    pub const SampleOuterShape = ssz.FixedProgressiveContainerType(struct {
        head: Uint8,
        inner: ssz.FixedProgressiveContainerType(struct { x: Uint16, y: Uint8 }, &.{ 1, 0, 1 }),
    }, &.{ 1, 0, 1 });
    pub const SampleSquareProgressiveList = SquareList;
    pub const SampleShapeContainer = ssz.FixedContainerType(struct { tag: Uint8, shape: Square });
};

pub const test_progressive_types = struct {
    pub const SampleUint64ProgressiveList = Uint64ProgressiveList;
    pub const SampleBytes32ProgressiveList = ssz.FixedProgressiveListType(Bytes32, .{});
    pub const SampleNestedProgressiveList = ssz.VariableProgressiveListType(ssz.FixedProgressiveListType(Uint16, .{}), .{});
    pub const ProgressiveBitList = ssz.ProgressiveBitListType(.{});
    pub const SampleContainerWithProgressiveList = ssz.VariableContainerType(struct { a: Uint16, b: Uint64ProgressiveList, c: Uint8 });
};
