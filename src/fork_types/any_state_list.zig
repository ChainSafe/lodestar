const std = @import("std");
const Allocator = std.mem.Allocator;
const CloneOpts = @import("ssz").CloneOpts;
const Node = @import("persistent_merkle_tree").Node;
const ForkSeq = @import("config").ForkSeq;
const ForkTypes = @import("fork_types.zig").ForkTypes;

fn StateListUnion(comptime field: []const u8, comptime iterator: bool) type {
    var names: [ForkSeq.count][:0]const u8 = undefined;
    var tags: [ForkSeq.count]u8 = undefined;
    var payloads: [ForkSeq.count]type = undefined;
    var attributes: [ForkSeq.count]std.builtin.Type.UnionField.Attributes = undefined;
    var count: usize = 0;
    for (std.meta.tags(ForkSeq)) |fork| {
        const State = ForkTypes(fork).BeaconState;
        if (!@hasField(State.Type, field)) continue;
        const List = State.getFieldType(field);
        if (List.kind != .list and List.kind != .progressive_list) {
            @compileError("AnyStateList requires a list field");
        }
        const Payload = if (iterator) List.TreeView.ReadonlyIterator else *List.TreeView;
        names[count] = @tagName(fork);
        tags[count] = @intFromEnum(fork);
        payloads[count] = Payload;
        attributes[count] = .{ .@"align" = @alignOf(Payload) };
        count += 1;
    }
    if (count == 0) @compileError("no supported fork has this state list field");
    const Tag = @Enum(u8, .exhaustive, names[0..count], tags[0..count]);
    return @Union(.auto, Tag, names[0..count], payloads[0..count], attributes[0..count]);
}

/// Borrows a list owned by its parent state. Clones and slices own their views until
/// transferred into a state or released with deinit(). Transfers require identical schemas.
pub fn AnyStateList(comptime field: []const u8) type {
    const Payload = StateListUnion(field, false);
    const FirstView = @typeInfo(Payload).@"union".fields[0].type;
    const List = @typeInfo(FirstView).pointer.child.SszType;
    return struct {
        inner: Payload,

        const Self = @This();
        pub const Element = List.TreeView.Element;
        pub const Value = List.Type;

        comptime {
            for (@typeInfo(Payload).@"union".fields) |variant| {
                const Variant = @typeInfo(variant.type).pointer.child.SszType;
                if (Variant.Element != List.Element or Variant.Type != Value or Variant.TreeView.Element != Element) {
                    @compileError("state list views must have identical element and value types across forks");
                }
            }
        }

        pub fn fromView(comptime fork: ForkSeq, view: *ForkTypes(fork).BeaconState.getFieldType(field).TreeView) Self {
            return .{ .inner = @unionInit(Payload, @tagName(fork), view) };
        }

        pub fn forkSeq(self: Self) ForkSeq {
            return @enumFromInt(@intFromEnum(std.meta.activeTag(self.inner)));
        }

        pub fn unwrap(self: Self, comptime Schema: type) error{IncompatibleListType}!*Schema.TreeView {
            return switch (self.inner) {
                inline else => |view| if (@TypeOf(view) == *Schema.TreeView) view else error.IncompatibleListType,
            };
        }

        pub fn length(self: Self) !usize {
            return switch (self.inner) {
                inline else => |view| view.length(),
            };
        }

        pub fn commit(self: Self) !void {
            return switch (self.inner) {
                inline else => |view| view.commit(),
            };
        }

        pub fn clearCache(self: Self) void {
            switch (self.inner) {
                inline else => |view| view.clearCache(),
            }
        }

        pub fn getRoot(self: Self) Node.Id {
            return switch (self.inner) {
                inline else => |view| view.getRoot(),
            };
        }

        pub fn get(self: Self, index: usize) !Element {
            return switch (self.inner) {
                inline else => |view| view.get(index),
            };
        }

        pub fn getReadonly(self: Self, index: usize) !Element {
            return switch (self.inner) {
                inline else => |view| view.getReadonly(index),
            };
        }

        pub fn set(self: Self, index: usize, value: Element) !void {
            return switch (self.inner) {
                inline else => |view| view.set(index, value),
            };
        }

        pub fn getValue(self: Self, allocator: Allocator, index: usize, out: *List.Element.Type) !void {
            return switch (self.inner) {
                inline else => |view| view.getValue(allocator, index, out),
            };
        }

        pub fn setValue(self: Self, index: usize, value: *const List.Element.Type) !void {
            return switch (self.inner) {
                inline else => |view| view.setValue(index, value),
            };
        }

        pub fn getFieldRoot(self: Self, index: usize) !*const [32]u8 {
            return switch (self.inner) {
                inline else => |view| view.getFieldRoot(index),
            };
        }

        pub fn getAll(self: Self, allocator: ?Allocator) ![]Element {
            return switch (self.inner) {
                inline else => |view| view.getAll(allocator),
            };
        }

        pub fn getAllInto(self: Self, out: []Element) ![]Element {
            return switch (self.inner) {
                inline else => |view| view.getAllInto(out),
            };
        }

        pub fn getAllReadonlyValues(self: Self, allocator: Allocator) ![]List.Element.Type {
            return switch (self.inner) {
                inline else => |view| view.getAllReadonlyValues(allocator),
            };
        }

        pub fn push(self: Self, value: Element) !void {
            return switch (self.inner) {
                inline else => |view| view.push(value),
            };
        }

        pub fn pushValue(self: Self, value: *const List.Element.Type) !void {
            return switch (self.inner) {
                inline else => |view| view.pushValue(value),
            };
        }

        pub fn growTo(self: Self, new_length: usize) !void {
            return switch (self.inner) {
                inline else => |view| view.growTo(new_length),
            };
        }

        pub fn clone(self: Self, opts: CloneOpts) !Self {
            return switch (self.inner) {
                inline else => |view, tag| .{ .inner = @unionInit(Payload, @tagName(tag), try view.clone(opts)) },
            };
        }

        pub fn sliceTo(self: Self, index: usize) !Self {
            return switch (self.inner) {
                inline else => |view, tag| .{ .inner = @unionInit(Payload, @tagName(tag), try view.sliceTo(index)) },
            };
        }

        pub fn sliceFrom(self: Self, index: usize) !Self {
            return switch (self.inner) {
                inline else => |view, tag| .{ .inner = @unionInit(Payload, @tagName(tag), try view.sliceFrom(index)) },
            };
        }

        pub fn deinit(self: Self) void {
            switch (self.inner) {
                inline else => |view| view.deinit(),
            }
        }

        pub fn toValue(self: Self, allocator: Allocator, out: *Value) !void {
            return switch (self.inner) {
                inline else => |view| view.toValue(allocator, out),
            };
        }

        pub fn hashTreeRoot(self: Self) !*const [32]u8 {
            return switch (self.inner) {
                inline else => |view| view.hashTreeRoot(),
            };
        }

        pub fn serializeIntoBytes(self: Self, out: []u8) !usize {
            return switch (self.inner) {
                inline else => |view| view.serializeIntoBytes(out),
            };
        }

        pub fn serializedSize(self: Self) !usize {
            return switch (self.inner) {
                inline else => |view| view.serializedSize(),
            };
        }

        pub fn iteratorReadonly(self: Self, start_index: usize) ReadonlyIterator {
            return switch (self.inner) {
                inline else => |view, tag| .{ .inner = @unionInit(IteratorPayload, @tagName(tag), view.iteratorReadonly(start_index)) },
            };
        }

        const IteratorPayload = StateListUnion(field, true);

        pub const ReadonlyIterator = struct {
            inner: IteratorPayload,

            pub fn nextValue(self: *ReadonlyIterator) !List.Element.Type {
                return switch (self.inner) {
                    inline else => |*iterator| iterator.nextValue(),
                };
            }

            pub fn nextValuePtr(self: *ReadonlyIterator) !*const List.Element.Type {
                return switch (self.inner) {
                    inline else => |*iterator| iterator.nextValuePtr(),
                };
            }

            pub fn nextRoot(self: *ReadonlyIterator) !*const [32]u8 {
                return switch (self.inner) {
                    inline else => |*iterator| iterator.nextRoot(),
                };
            }
        };
    };
}
