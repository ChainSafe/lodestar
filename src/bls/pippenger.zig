//! Parallel multi-scalar multiplication via tile Pippenger.
//!
//! The MSM is split into an `nx × ny` grid of independent tiles — each tile covers
//! a chunk of points × a window of scalar bits. Workers race for tiles via an
//! atomic counter and call `blst_p?s_tile_pippenger`; once every tile is done
//! the calling thread assembles them top-to-bottom Horner-style (double `wnd`
//! times between rows, then add that row's tiles).
//!
//! ## Curve genericity
//!
//! The algorithm is identical for G1 (public keys) and G2 (signatures) — only
//! the C entry points and point types change. We capture that in a
//! `CurveDescriptor` value (`G1` / `G2` below) and write the algorithm once in
//! `parallelMSM(comptime Curve: CurveDescriptor, ...)`. `parallelMSMG1` /
//! `parallelMSMG2` are thin wrappers that fix the curve.
//!
//! ## Fallback
//!
//! For `pool.n_workers < 2` or `npoints < 2` we skip the grid and call
//! single-threaded `Curve.mult_pippenger` directly since the overhead is not
//! worth it.
//!
//! For `2 <= npoints < 32` we match the Rust binding's small-MSM
//! branch: workers perform per-point scalar multiplication and reduce partial
//! projective results, avoiding tiled Pippenger setup for tiny batches.
//!
//! Note: This is a direct port of blst's Rust binding `MultiPoint::mult` (pippenger.rs).

const std = @import("std");
const c = @import("root.zig").c;
const blst = @import("root.zig");
const PublicKey = blst.PublicKey;
const Signature = blst.Signature;
const ThreadPool = @import("ThreadPool.zig");
const WorkItem = ThreadPool.WorkItem;
const PoolError = ThreadPool.PoolError;
const MAX_WORKERS = ThreadPool.MAX_WORKERS;

/// Curve descriptor: bundles the projective point type, the affine wrapper
/// (`PublicKey` / `Signature` — both wrap the corresponding `*_affine` C type
/// at offset 0, so `@ptrCast` to `*const blst_p?_affine` is sound), and the
/// five blst C entry points the algorithm needs.
///
/// The four point-typed function pointers are stored as `*const anyopaque`
/// because their typed signatures reference `Projective` / `Wrapper` from the
/// same struct, and Zig can't cross-reference fields like that. `parallelMSM`
/// reconstructs the typed function-pointer types from `Projective` / `Wrapper`
/// and `@ptrCast`s back at call sites at comptime.
const CurveDescriptor = struct {
    Projective: type,
    Wrapper: type,
    scratch_sizeof: *const fn (npoints: usize) callconv(.c) usize,
    mult_pippenger: *const anyopaque,
    tile_pippenger: *const anyopaque,
    from_affine: *const anyopaque,
    mult: *const anyopaque,
    add_or_double: *const anyopaque,
    double: *const anyopaque,
};

const G1: CurveDescriptor = .{
    .Projective = c.blst_p1,
    .Wrapper = PublicKey,
    .scratch_sizeof = c.blst_p1s_mult_pippenger_scratch_sizeof,
    .mult_pippenger = @ptrCast(&c.blst_p1s_mult_pippenger),
    .tile_pippenger = @ptrCast(&c.blst_p1s_tile_pippenger),
    .from_affine = @ptrCast(&c.blst_p1_from_affine),
    .mult = @ptrCast(&c.blst_p1_mult),
    .add_or_double = @ptrCast(&c.blst_p1_add_or_double),
    .double = @ptrCast(&c.blst_p1_double),
};

const G2: CurveDescriptor = .{
    .Projective = c.blst_p2,
    .Wrapper = Signature,
    .scratch_sizeof = c.blst_p2s_mult_pippenger_scratch_sizeof,
    .mult_pippenger = @ptrCast(&c.blst_p2s_mult_pippenger),
    .tile_pippenger = @ptrCast(&c.blst_p2s_tile_pippenger),
    .from_affine = @ptrCast(&c.blst_p2_from_affine),
    .mult = @ptrCast(&c.blst_p2_mult),
    .add_or_double = @ptrCast(&c.blst_p2_add_or_double),
    .double = @ptrCast(&c.blst_p2_double),
};

/// Number of significant bits in `l`. Returns 0 for 0.
fn numBits(l: usize) usize {
    return @bitSizeOf(usize) - @clz(l);
}

/// Pippenger window size before the breakdown decides how to slice it across
/// workers.
fn pippengerWindowSize(npoints: usize) usize {
    const wbits = numBits(npoints);
    if (wbits > 13) return wbits - 4;
    if (wbits > 5) return wbits - 3;
    return 2;
}

/// Direct port of blst's Rust `breakdown` (pippenger.rs:503). Picks the grid
/// shape that splits the work evenly across `ncpus` while keeping each tile's
/// scratch buffer small.
///
/// Returns:
///   - `nx`: number of point-chunks per row (columns in the grid).
///   - `ny`: number of bit-windows (rows in the grid).
///   - `wnd`: window size used for tiles below the top row; the top row covers
///     whatever bits remain (`nbits - wnd*(ny-1)`) and is auto-clipped by
///     `tile_pippenger`.
fn breakdownTiles(
    nbits: usize,
    window: usize,
    ncpus: usize,
) struct { nx: usize, ny: usize, wnd: usize } {
    var nx: usize = undefined;
    var wnd: usize = undefined;

    if (nbits > window * ncpus) {
        nx = 1;
        wnd = numBits(ncpus / 4);
        if (window + wnd > 18) {
            wnd = window - wnd;
        } else {
            const a = (nbits / window + ncpus - 1) / ncpus;
            const b = (nbits / (window + 1) + ncpus - 1) / ncpus;
            wnd = if (b < a) window + 1 else window;
        }
    } else {
        nx = 2;
        wnd = window - 2;
        while ((nbits / wnd + 1) * nx < ncpus) {
            nx += 1;
            wnd = window - numBits(3 * nx / 2);
        }
        nx -= 1;
        wnd = window - numBits(3 * nx / 2);
    }

    const ny = nbits / wnd + 1;
    wnd = nbits / ny + 1;
    return .{ .nx = nx, .ny = ny, .wnd = wnd };
}

/// One tile of the Pippenger grid:
///   - `x`: starting point index.
///   - `dx`: number of points covered by this tile.
///   - `y`: starting bit position of the scalar window.
///
/// Note: we do not have `dy` here because `dy` is written and never read
/// upstream!
const TileDesc = struct { x: usize, dx: usize, y: usize };

/// Lays out `tiles` top row first (highest `y`), going down. Each row has
/// `nx` tiles covering point chunks `[i*dx, (i+1)*dx)`; the last column in
/// the top row absorbs any rounding remainder so every point is covered.
/// We don't precompute the top row's window — `tile_pippenger` clips
/// internally when `bit0 + window > nbits`, so passing `window` for every
/// tile is correct.
fn buildTiles(npoints: usize, nx: usize, ny: usize, window: usize, tiles: []TileDesc) void {
    const dx = npoints / nx;
    const y_top: usize = window * (ny - 1);

    var total: usize = 0;
    while (total < nx) : (total += 1) {
        tiles[total] = .{ .x = total * dx, .dx = dx, .y = y_top };
    }
    if (nx > 0) tiles[nx - 1].dx = npoints - tiles[nx - 1].x;

    var y_cur = y_top;
    while (y_cur != 0) {
        y_cur -= window;
        for (0..nx) |i| {
            tiles[total] = .{ .x = tiles[i].x, .dx = tiles[i].dx, .y = y_cur };
            total += 1;
        }
    }
}

/// Typed function-pointer signature for `blst_p?s_tile_pippenger`, reconstructed
/// from a `CurveDescriptor`. Matches the C ABI for both G1 and G2 once
/// `Projective` and `Wrapper` are fixed.
fn TilePippengerFn(comptime Curve: CurveDescriptor) type {
    return *const fn (
        *Curve.Projective,
        [*c]*const Curve.Wrapper,
        usize,
        [*c]*const u8,
        usize,
        [*c]u64,
        usize,
        usize,
    ) callconv(.c) void;
}

/// Typed function-pointer signature for `blst_p?s_mult_pippenger`.
fn MultPippengerFn(comptime Curve: CurveDescriptor) type {
    return *const fn (
        *Curve.Projective,
        [*c]*const Curve.Wrapper,
        usize,
        [*c]*const u8,
        usize,
        [*c]u64,
    ) callconv(.c) void;
}

/// Typed function-pointer signature for `blst_p?_from_affine`.
fn FromAffineFn(comptime Curve: CurveDescriptor) type {
    return *const fn (*Curve.Projective, *const Curve.Wrapper) callconv(.c) void;
}

/// Typed function-pointer signature for `blst_p?_mult`.
fn MultFn(comptime Curve: CurveDescriptor) type {
    return *const fn (*Curve.Projective, *const Curve.Projective, [*c]const u8, usize) callconv(.c) void;
}

/// Typed function-pointer signature for `blst_p?_add_or_double`.
fn AddOrDoubleFn(comptime Curve: CurveDescriptor) type {
    return *const fn (*Curve.Projective, *const Curve.Projective, *const Curve.Projective) callconv(.c) void;
}

/// Typed function-pointer signature for `blst_p?_double`.
fn DoubleFn(comptime Curve: CurveDescriptor) type {
    return *const fn (*Curve.Projective, *const Curve.Projective) callconv(.c) void;
}

fn SmallMsmJob(comptime Curve: CurveDescriptor) type {
    return struct {
        points: []*const Curve.Wrapper,
        scalars_refs: []*const u8,
        nbits: usize,
        counter: std.atomic.Value(usize),
    };
}

fn SmallMsmWorkItem(comptime Curve: CurveDescriptor) type {
    return struct {
        const Self = @This();

        base: WorkItem,
        job: *SmallMsmJob(Curve),
        result: Curve.Projective = undefined,
        did_work: bool = false,

        fn exec(base_item: *WorkItem) void {
            const self: *Self = @fieldParentPtr("base", base_item);
            const job = self.job;
            const from_affine: FromAffineFn(Curve) = @ptrCast(@alignCast(Curve.from_affine));
            const mult: MultFn(Curve) = @ptrCast(@alignCast(Curve.mult));
            const add_or_double: AddOrDoubleFn(Curve) = @ptrCast(@alignCast(Curve.add_or_double));

            var acc: Curve.Projective = undefined;
            var tmp: Curve.Projective = undefined;
            var did_work = false;

            while (true) {
                const i = job.counter.fetchAdd(1, .monotonic);
                if (i >= job.points.len) break;

                from_affine(&tmp, job.points[i]);
                if (!did_work) {
                    mult(&acc, &tmp, @ptrCast(job.scalars_refs[i]), job.nbits);
                    did_work = true;
                } else {
                    mult(&tmp, &tmp, @ptrCast(job.scalars_refs[i]), job.nbits);
                    add_or_double(&acc, &acc, &tmp);
                }
            }

            self.did_work = did_work;
            if (did_work) self.result = acc;
        }
    };
}

fn smallMSM(
    comptime Curve: CurveDescriptor,
    pool: *ThreadPool,
    io: std.Io,
    points: []*const Curve.Wrapper,
    scalars_refs: []*const u8,
    nbits: usize,
    out: *Curve.Projective,
) (PoolError || std.Io.Cancelable)!void {
    const n_active = @min(pool.n_workers, points.len);
    const Job = SmallMsmJob(Curve);
    const Item = SmallMsmWorkItem(Curve);

    var job = Job{
        .points = points,
        .scalars_refs = scalars_refs,
        .nbits = nbits,
        .counter = std.atomic.Value(usize).init(0),
    };

    var work_items: [MAX_WORKERS]Item = undefined;
    var item_ptrs: [MAX_WORKERS]*WorkItem = undefined;
    for (0..n_active) |i| {
        work_items[i] = .{
            .base = .{ .exec_fn = Item.exec },
            .job = &job,
        };
        item_ptrs[i] = &work_items[i].base;
    }

    try pool.submitAndWait(io, item_ptrs[0..n_active]);

    const add_or_double: AddOrDoubleFn(Curve) = @ptrCast(@alignCast(Curve.add_or_double));
    var have_result = false;
    for (work_items[0..n_active]) |*item| {
        if (!item.did_work) continue;
        if (!have_result) {
            out.* = item.result;
            have_result = true;
        } else {
            add_or_double(out, out, &item.result);
        }
    }
    std.debug.assert(have_result);
}

/// Shared state for a single `parallelMSM` invocation. Lives on the calling
/// thread's stack; workers read it through their `TilePippengerWorkItem`.
/// `scratch_buf` is split into `n_active` per-worker chunks of
/// `scratch_per_worker` u64s; each worker only touches its own slice, so no
/// synchronization is needed. `results` is similarly partitioned by the
/// `counter` — each tile index is claimed by exactly one worker.
fn TilePippengerJob(comptime Curve: CurveDescriptor) type {
    return struct {
        points: []*const Curve.Wrapper,
        scalars_refs: []*const u8,
        nbits: usize,
        wnd: usize,
        tiles: []const TileDesc,
        results: []Curve.Projective,
        scratch_buf: []u64,
        scratch_per_worker: usize,
        counter: std.atomic.Value(usize),
    };
}

/// A worker on the bls `ThreadPool`. Each work item holds a `worker_id` so
/// it can find its scratch slice; multiple work items share one job and race
/// on `job.counter` to claim tiles.
fn TilePippengerWorkItem(comptime Curve: CurveDescriptor) type {
    return struct {
        const Self = @This();

        base: WorkItem,
        job: *TilePippengerJob(Curve),
        worker_id: usize,

        fn exec(base_item: *WorkItem) void {
            const self: *Self = @fieldParentPtr("base", base_item);
            const job = self.job;
            const offset = self.worker_id * job.scratch_per_worker;
            const scratch = job.scratch_buf[offset .. offset + job.scratch_per_worker];
            const tile_pippenger: TilePippengerFn(Curve) = @ptrCast(@alignCast(Curve.tile_pippenger));

            while (true) {
                const i = job.counter.fetchAdd(1, .monotonic);
                if (i >= job.tiles.len) break;

                const tile = job.tiles[i];
                tile_pippenger(
                    &job.results[i],
                    @ptrCast(job.points[tile.x..].ptr),
                    tile.dx,
                    @ptrCast(job.scalars_refs[tile.x..].ptr),
                    job.nbits,
                    @ptrCast(scratch.ptr),
                    tile.y,
                    job.wnd,
                );
            }
        }
    };
}

/// Generic parallel multi-scalar multiplication. Computes
/// `out = sum_i points[i] * scalars[i]` over either curve.
///
/// Caller invariants:
///   - `points.len > 0` and `points.len == scalars_refs.len` (asserted).
///   - Each `scalars_refs[i]` points to at least `(nbits + 7) / 8` bytes.
///   - `scalars_refs` follows blst's "array of pointers" calling convention:
///     each element is a distinct pointer; no NULL sentinel needed (blst
///     handles both `[start_ptr, NULL]` and per-point arrays).
///
/// Notes on the implementation:
///   - `Curve.scratch_sizeof(0)` returns `2 * sizeof(point_xyzz)` bytes (the
///     base bucket size for `pippenger_window_size(0) = 2`); per-worker scratch
///     is `(that / 8) << (wnd-1)` u64s, matching Rust's formula.
///   - We must zero `scratch_buf` on first use because blst's static
///     `tile_pippenger` doesn't zero buckets — its companion
///     `integrate_buckets` zeros them while consuming, so the second call onward
///     starts from zero again, but the first does not.
///   - Top-to-bottom Horner assembly: `out = top_row`, then for each row
///     below, double `wnd` times and add the row's tiles. Equivalent to
///     `sum_r row_r * 2^((ny-1-r)*wnd)`.
fn parallelMSM(
    comptime Curve: CurveDescriptor,
    pool: *ThreadPool,
    io: std.Io,
    points: []*const Curve.Wrapper,
    scalars_refs: []*const u8,
    nbits: usize,
    out: *Curve.Projective,
) (PoolError || std.Io.Cancelable || std.mem.Allocator.Error)!void {
    const npoints = points.len;
    std.debug.assert(npoints > 0);
    std.debug.assert(npoints == scalars_refs.len);

    const ncpus = pool.n_workers;

    if (ncpus < 2 or npoints < 2) {
        const scratch_size_u64 = Curve.scratch_sizeof(npoints) / @sizeOf(u64);
        const scratch = try pool.allocator.alloc(u64, scratch_size_u64);
        defer pool.allocator.free(scratch);
        const mult_pippenger: MultPippengerFn(Curve) = @ptrCast(@alignCast(Curve.mult_pippenger));
        mult_pippenger(
            out,
            @ptrCast(points.ptr),
            npoints,
            @ptrCast(scalars_refs.ptr),
            nbits,
            scratch.ptr,
        );
        return;
    }

    if (ncpus >= 2 and npoints < 32) {
        try smallMSM(Curve, pool, io, points, scalars_refs, nbits, out);
        return;
    }

    const window = pippengerWindowSize(npoints);
    const bd = breakdownTiles(nbits, window, ncpus);
    const total = bd.nx * bd.ny;
    const n_active = @min(ncpus, total);

    const sz_bytes = Curve.scratch_sizeof(0);
    const scratch_per_worker = (sz_bytes / @sizeOf(u64)) << @intCast(bd.wnd - 1);

    const scratch_buf = try pool.allocator.alloc(u64, scratch_per_worker * n_active);
    defer pool.allocator.free(scratch_buf);
    @memset(scratch_buf, 0);

    const tiles = try pool.allocator.alloc(TileDesc, total);
    defer pool.allocator.free(tiles);
    buildTiles(npoints, bd.nx, bd.ny, bd.wnd, tiles);

    const results = try pool.allocator.alloc(Curve.Projective, total);
    defer pool.allocator.free(results);

    const Job = TilePippengerJob(Curve);
    const Item = TilePippengerWorkItem(Curve);

    var job = Job{
        .points = points,
        .scalars_refs = scalars_refs,
        .nbits = nbits,
        .wnd = bd.wnd,
        .tiles = tiles,
        .results = results,
        .scratch_buf = scratch_buf,
        .scratch_per_worker = scratch_per_worker,
        .counter = std.atomic.Value(usize).init(0),
    };

    var work_items: [MAX_WORKERS]Item = undefined;
    var item_ptrs: [MAX_WORKERS]*WorkItem = undefined;
    for (0..n_active) |i| {
        work_items[i] = .{
            .base = .{ .exec_fn = Item.exec },
            .job = &job,
            .worker_id = i,
        };
        item_ptrs[i] = &work_items[i].base;
    }

    try pool.submitAndWait(io, item_ptrs[0..n_active]);

    // Sequential top-to-bottom Horner assembly.
    // Note this is where implementation differs: The Rust binding pipelines this
    // with worker progress (channel + per-row atomic counter + readiness array,
    // so accumulation can start on the top row while lower rows are still
    // computing). We don't — `submitAndWait` already drained every worker, so
    // every row is ready, in order.
    const add_or_double: AddOrDoubleFn(Curve) = @ptrCast(@alignCast(Curve.add_or_double));
    const double: DoubleFn(Curve) = @ptrCast(@alignCast(Curve.double));
    out.* = results[0];
    for (1..bd.nx) |i| add_or_double(out, out, &results[i]);
    for (1..bd.ny) |row| {
        for (0..bd.wnd) |_| double(out, out);
        for (0..bd.nx) |col| add_or_double(out, out, &results[row * bd.nx + col]);
    }
}

/// MSM in G1 (public-key curve). Specialization of `parallelMSM` to `G1`.
pub fn parallelMSMG1(
    pool: *ThreadPool,
    io: std.Io,
    pks: []*const PublicKey,
    scalars_refs: []*const u8,
    nbits: usize,
    out: *c.blst_p1,
) (PoolError || std.Io.Cancelable || std.mem.Allocator.Error)!void {
    return parallelMSM(G1, pool, io, pks, scalars_refs, nbits, out);
}

/// MSM in G2 (signature curve). Specialization of `parallelMSM` to `G2`.
pub fn parallelMSMG2(
    pool: *ThreadPool,
    io: std.Io,
    sigs: []*const Signature,
    scalars_refs: []*const u8,
    nbits: usize,
    out: *c.blst_p2,
) (PoolError || std.Io.Cancelable || std.mem.Allocator.Error)!void {
    return parallelMSM(G2, pool, io, sigs, scalars_refs, nbits, out);
}
