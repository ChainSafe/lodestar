//! These sizes come from the discv5 wire spec. Each one is a protocol fact rather than a tuning
//! knob.

const std = @import("std");

pub const packet_size_min: usize = 63;
pub const packet_size_max: usize = 1_280;
pub const masking_iv_size: usize = 16;
pub const static_header_size: usize = 23;
pub const nonce_size: usize = 12;
pub const node_id_size: usize = 32;
pub const gcm_tag_size: usize = 16;
pub const id_nonce_size: usize = 16;
pub const enr_size_max: usize = 300;
pub const id_signature_size: usize = 64;
pub const ephemeral_key_size: usize = 33;
pub const handshake_authdata_head_size: usize = 34;
pub const handshake_authdata_size_min: usize = handshake_authdata_head_size +
    id_signature_size + ephemeral_key_size;
pub const handshake_authdata_size_max: usize = handshake_authdata_size_min + enr_size_max;
pub const whoareyou_authdata_size: usize = id_nonce_size + @sizeOf(u64);
pub const whoareyou_packet_size: usize = masking_iv_size + static_header_size +
    whoareyou_authdata_size;
pub const header_size_max: usize = static_header_size + handshake_authdata_size_max;
pub const associated_data_size_max: usize = masking_iv_size + header_size_max;
pub const ordinary_packet_overhead: usize = masking_iv_size + static_header_size +
    node_id_size + gcm_tag_size;
pub const ordinary_plaintext_size_max: usize = packet_size_max - ordinary_packet_overhead;
pub const handshake_plaintext_size_max: usize = packet_size_max - masking_iv_size -
    static_header_size - handshake_authdata_size_min - gcm_tag_size;

comptime {
    std.debug.assert(whoareyou_packet_size == packet_size_min);
    std.debug.assert(ordinary_plaintext_size_max == 1_193);
    std.debug.assert(ordinary_packet_overhead == 87);
    std.debug.assert(handshake_plaintext_size_max == 1_094);
    std.debug.assert(header_size_max < packet_size_max);
}
