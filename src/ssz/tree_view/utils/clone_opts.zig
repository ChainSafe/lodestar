pub const CloneOpts = struct {
    /// When true, transfer *safe* cache entries from `self` into the clone.
    /// When false, the clone starts with an empty cache and `self` keeps its caches.
    transfer_cache: bool = true,
};
