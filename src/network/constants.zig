pub const alpn = "libp2p";
pub const datagram_size_max: usize = 1_500;
pub const receive_batch_max: u32 = 32;
pub const send_batch_max: u8 = 16;
pub const poll_interval_ms: u32 = 50;

pub const MAX_PAYLOAD_SIZE: usize = 10 * 1024 * 1024;
pub const snappy_overhead: usize = 32;

pub fn maxCompressedLen(uncompressed: usize) usize {
    return snappy_overhead + uncompressed + uncompressed / 6;
}
