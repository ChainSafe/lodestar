//! Shared parser for `TransitionOpts` from a JS options object.
//!
//! This file is intentionally not registered with `root.zig` as a module export —
//! its `pub fn` should be visible to other napi files but never auto-exposed to JS.
//! (zapi tries to export every pub fn in modules listed in `root.zig`, which would
//! fail here because `TransitionOpts` isn't a JS-convertible return type.)

const std = @import("std");
const js = @import("zapi:zapi").js;
const st = @import("state_transition");

/// Parse a JS options object into Zig's `TransitionOpts`.
///
/// Recognized fields:
/// - `verifyStateRoot`, `verifyProposer`, `verifySignatures`: bool
/// - `dontTransferCache`: bool (negated to set `transfer_cache`)
/// - `executionPayloadStatus`: "valid" | "invalid"
/// - `dataAvailabilityStatus`: "Available" | "PreData" | "OutOfRange"
/// - `source`: "block" | "regen" | "get_historical_state"
///
/// Throws `error.InvalidExecutionPayloadStatus`, `error.InvalidDataAvailabilityStatus`,
/// or `error.InvalidProcessBlockSource` for unknown enum strings.
///
/// TODO(bing): rename `dontTransferCache` → `transferCache` to drop the double negation.
pub fn parseOptions(options: ?js.Value) !st.TransitionOpts {
    var transition_opts: st.TransitionOpts = .{};

    if (options) |value| {
        const raw = value.toValue();
        if (try raw.typeof() == .object) {
            if (try raw.hasNamedProperty("verifyStateRoot")) {
                transition_opts.verify_state_root = try (try raw.getNamedProperty("verifyStateRoot")).getValueBool();
            }
            if (try raw.hasNamedProperty("verifyProposer")) {
                transition_opts.verify_proposer = try (try raw.getNamedProperty("verifyProposer")).getValueBool();
            }
            if (try raw.hasNamedProperty("verifySignatures")) {
                transition_opts.verify_signatures = try (try raw.getNamedProperty("verifySignatures")).getValueBool();
            }
            if (try raw.hasNamedProperty("dontTransferCache")) {
                transition_opts.transfer_cache = !(try (try raw.getNamedProperty("dontTransferCache")).getValueBool());
            }
            if (try raw.hasNamedProperty("executionPayloadStatus")) {
                var buf: [16]u8 = undefined;
                const status_str = try (try raw.getNamedProperty("executionPayloadStatus")).getValueStringUtf8(&buf);
                transition_opts.block_external_data.execution_payload_status =
                    if (std.mem.eql(u8, status_str, "valid"))
                        .valid
                    else if (std.mem.eql(u8, status_str, "invalid"))
                        .invalid
                    else
                        return error.InvalidExecutionPayloadStatus;
            }
            if (try raw.hasNamedProperty("dataAvailabilityStatus")) {
                var buf: [16]u8 = undefined;
                const da_str = try (try raw.getNamedProperty("dataAvailabilityStatus")).getValueStringUtf8(&buf);
                transition_opts.block_external_data.data_availability_status =
                    if (std.mem.eql(u8, da_str, "Available"))
                        .available
                    else if (std.mem.eql(u8, da_str, "PreData"))
                        .pre_data
                    else if (std.mem.eql(u8, da_str, "OutOfRange"))
                        .out_of_range
                        // TODO(bing): uncomment once gloas support is in
                        // else if (std.mem.eql(u8, da_str, "NotRequired")) .not_required;
                    else
                        return error.InvalidDataAvailabilityStatus;
            }
            if (try raw.hasNamedProperty("source")) {
                var buf: [32]u8 = undefined;
                const source_str = try (try raw.getNamedProperty("source")).getValueStringUtf8(&buf);
                transition_opts.source =
                    if (std.mem.eql(u8, source_str, "block"))
                        .block
                    else if (std.mem.eql(u8, source_str, "regen"))
                        .regen
                    else if (std.mem.eql(u8, source_str, "get_historical_state"))
                        .get_historical_state
                    else
                        return error.InvalidProcessBlockSource;
            }
        }
    }
    return transition_opts;
}
