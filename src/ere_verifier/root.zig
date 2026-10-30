//! EIP-8025 execution proof verification through ere's C verifier library.
//!
//! [ere] verifies the zkVM proofs that EIP-8025 provers produce.
//!
//! `Verifier` wraps one `EreVerifier` handle bound to a guest
//! program's verifying key and returns the public values a proof commits to.
//! Binding those values to a payload is the caller's job.
//!
//! [ere]: https://github.com/eth-act/ere

const std = @import("std");

pub const Verifier = @import("Verifier.zig");
pub const ZkvmKind = Verifier.ZkvmKind;
pub const available = Verifier.available;

test {
    std.testing.refAllDecls(@This());
}
