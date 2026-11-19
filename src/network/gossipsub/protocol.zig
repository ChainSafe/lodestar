pub const Version = enum(u8) { v1_0, v1_1, v1_2 };
pub const versions = [_]Version{ .v1_2, .v1_1, .v1_0 };

/// Advertised protocol IDs, newest first.
pub const ids = [_][]const u8{ "/meshsub/1.2.0", "/meshsub/1.1.0", "/meshsub/1.0.0" };
