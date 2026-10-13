const std = @import("std");
const testing = std.testing;

pub const types = @import("type/root.zig");
pub const BYTES_PER_CHUNK = types.BYTES_PER_CHUNK;

pub const TypeKind = types.TypeKind;
pub const isBasicType = types.isBasicType;
pub const isFixedType = types.isFixedType;

pub const BoolType = types.BoolType;
pub const UintType = types.UintType;

pub const BitListType = types.BitListType;
pub const isBitListType = types.isBitListType;

pub const BitVectorType = types.BitVectorType;
pub const isBitVectorType = types.isBitVectorType;

pub const ByteListType = types.ByteListType;
pub const isByteListType = types.isByteListType;

pub const ByteVectorType = types.ByteVectorType;
pub const isByteVectorType = types.isByteVectorType;

pub const FixedListType = types.FixedListType;
pub const VariableListType = types.VariableListType;

pub const FixedVectorType = types.FixedVectorType;
pub const VariableVectorType = types.VariableVectorType;

pub const FixedContainerType = types.FixedContainerType;
pub const StructContainerType = types.StructContainerType;
pub const VariableContainerType = types.VariableContainerType;

// Progressive container types
pub const FixedProgressiveContainerType = types.FixedProgressiveContainerType;
pub const StructProgressiveContainerType = types.StructProgressiveContainerType;
pub const VariableProgressiveContainerType = types.VariableProgressiveContainerType;

// Progressive list types
pub const FixedProgressiveListType = types.FixedProgressiveListType;
pub const VariableProgressiveListType = types.VariableProgressiveListType;

// Progressive bit list
pub const ProgressiveBitListType = types.ProgressiveBitListType;
pub const isProgressiveBitListType = types.isProgressiveBitListType;

// Compatible union
pub const CompatibleUnionType = types.CompatibleUnionType;
pub const getPathGindex = types.getPathGindex;

const hasher = @import("hasher.zig");
pub const Hasher = hasher.Hasher;
pub const HasherData = hasher.HasherData;

const tree_view = @import("tree_view/root.zig");
pub const ContainerTreeView = tree_view.ContainerTreeView;
pub const StructContainerTreeView = tree_view.StructContainerTreeView;
pub const ArrayBasicTreeView = tree_view.ArrayBasicTreeView;
pub const ArrayCompositeTreeView = tree_view.ArrayCompositeTreeView;
pub const ListBasicTreeView = tree_view.ListBasicTreeView;
pub const ListCompositeTreeView = tree_view.ListCompositeTreeView;
pub const CloneOpts = @import("tree_view/utils/clone_opts.zig").CloneOpts;

test {
    _ = types;
    _ = tree_view;
    _ = hasher;
    _ = @import("root_test.zig");
    testing.refAllDecls(@This());
}
