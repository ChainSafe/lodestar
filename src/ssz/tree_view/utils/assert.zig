/// To implement a TreeView type, you must implement the following functions:
///   pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self
///   pub fn deinit(self: *Self) void
///   pub fn commit(self: *Self) !void
///   pub fn getRoot(self: *const Self) Node.Id
///   pub fn hashTreeRoot(self: *Self, out: *[32]u8) !void
///
/// it usually also contains these fields:
///   allocator: Allocator
///   pool: *Node.Pool
///   root: Node.Id
pub fn assertTreeViewType(comptime TV: type) void {
    if (!@hasDecl(TV, "init")) {
        @compileError("TreeView type must implement 'init' function");
    }

    const init_fn_info = @typeInfo(@TypeOf(TV.init));
    if (init_fn_info != .@"fn") {
        @compileError("TreeView 'init' must be a function");
    }

    const return_type = init_fn_info.@"fn".return_type orelse @compileError("TreeView 'init' must have a return type");

    const return_payload_type = switch (@typeInfo(return_type)) {
        .error_union => |eu| eu.payload,
        else => @compileError("TreeView 'init' must return an error union"),
    };

    const Self = switch (@typeInfo(return_payload_type)) {
        .pointer => |ptr_info| ptr_info.child,
        else => @compileError("TreeView 'init' must return a pointer to TreeView type"),
    };

    if (Self != TV) {
        @compileError("TreeView 'init' must return pointer to Self type");
    }

    if (!@hasDecl(TV, "deinit")) {
        @compileError("TreeView type must implement 'deinit' function");
    }

    if (!@hasDecl(TV, "commit")) {
        @compileError("TreeView type must implement 'commit' function");
    }

    if (!@hasDecl(TV, "getRoot")) {
        @compileError("TreeView type must implement 'getRoot' function");
    }

    if (!@hasDecl(TV, "hashTreeRoot")) {
        @compileError("TreeView type must implement 'hashTreeRoot' function");
    }
}
