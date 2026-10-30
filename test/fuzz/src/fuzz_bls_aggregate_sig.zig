const bls = @import("bls");

const Signature = bls.Signature;
const AggregateSignature = bls.AggregateSignature;
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
    const sig_size = Signature.COMPRESS_SIZE;
    const n = @min(input.len / sig_size, MAX_AGGREGATE_PER_JOB);
    if (n == 0) return;

    var sigs: [MAX_AGGREGATE_PER_JOB]Signature = undefined;
    var count: usize = 0;

    for (0..n) |i| {
        const chunk = input[i * sig_size .. (i + 1) * sig_size];
        const sig = Signature.deserialize(chunk) catch continue;
        sigs[count] = sig;
        count += 1;
    }

    if (count == 0) return;

    _ = AggregateSignature.aggregate(sigs[0..count], false) catch |err| {
        if (err != error.AggrTypeMismatch) {
            @panic("unexpected aggregate signature error");
        }
    };
}
