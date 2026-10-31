const bls = @import("bls");

const PublicKey = bls.PublicKey;
const AggregatePublicKey = bls.AggregatePublicKey;
const MAX_AGGREGATE_PER_JOB = bls.MAX_AGGREGATE_PER_JOB;

pub export fn zig_fuzz_init() callconv(.c) void {}

pub export fn zig_fuzz_test(
    buf: [*]const u8,
    len: usize,
) callconv(.c) void {
    const input = buf[0..len];
    fuzzAggregate(input);
}

fn fuzzAggregate(input: []const u8) void {
    const pk_size = PublicKey.COMPRESS_SIZE;
    if (input.len < pk_size or input.len > pk_size * MAX_AGGREGATE_PER_JOB) return;

    const n = @min(input.len / pk_size, MAX_AGGREGATE_PER_JOB);
    if (n == 0) return;

    var pks: [MAX_AGGREGATE_PER_JOB]PublicKey = undefined;
    var count: usize = 0;

    for (0..n) |i| {
        const chunk = input[i * pk_size .. (i + 1) * pk_size];
        const pk = PublicKey.deserialize(chunk) catch continue;
        pks[count] = pk;
        count += 1;
    }

    if (count == 0) return;

    _ = AggregatePublicKey.aggregate(pks[0..count], false) catch |err| {
        if (err != error.AggrTypeMismatch) {
            @panic("unexpected aggregate public key error");
        }
    };
}
