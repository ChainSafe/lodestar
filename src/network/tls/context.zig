const cert = @import("cert.zig");
const constants = @import("../constants.zig");
const keys = @import("../wire/keys.zig");
const peer_id = @import("../wire/peer_id.zig");
const verify = @import("verify.zig");
const c = @import("quiche_zig:quiche");

pub const Error = error{OpenSslFailed} || cert.Error;

pub const HandshakeState = struct {
    now_unix: i64 = 0,
    peer_id: ?peer_id.PeerId = null,
    failure: ?verify.Error = null,
};

const alpn_protos = [_]u8{constants.alpn.len} ++ constants.alpn.*;

pub const Context = struct {
    ssl_ctx: *c.SSL_CTX,
    certificate: cert.Certificate,
    local_peer_id: peer_id.PeerId,

    pub fn init(host: *const keys.KeyPair, now_unix: i64, serial: [8]u8) Error!Context {
        const host_key = host.publicKey();

        var certificate = try cert.Certificate.create(host, now_unix, serial);
        errdefer certificate.deinit();

        const ssl_ctx = c.SSL_CTX_new(c.TLS_method()) orelse return error.OpenSslFailed;
        errdefer c.SSL_CTX_free(ssl_ctx);

        if (c.SSL_CTX_set_min_proto_version(ssl_ctx, c.TLS1_3_VERSION) != 1) {
            return error.OpenSslFailed;
        }
        if (c.SSL_CTX_set_max_proto_version(ssl_ctx, c.TLS1_3_VERSION) != 1) {
            return error.OpenSslFailed;
        }
        if (c.SSL_CTX_use_certificate(ssl_ctx, certificate.x509) != 1) return error.OpenSslFailed;
        if (c.SSL_CTX_use_PrivateKey(ssl_ctx, certificate.key) != 1) return error.OpenSslFailed;
        _ = c.SSL_CTX_set_options(ssl_ctx, c.SSL_OP_NO_TICKET);
        if (c.SSL_CTX_set_alpn_protos(ssl_ctx, &alpn_protos, alpn_protos.len) != 0) {
            return error.OpenSslFailed;
        }
        c.SSL_CTX_set_alpn_select_cb(ssl_ctx, alpnSelect, null);
        c.SSL_CTX_set_custom_verify(
            ssl_ctx,
            c.SSL_VERIFY_PEER | c.SSL_VERIFY_FAIL_IF_NO_PEER_CERT,
            verifyCallback,
        );

        return .{
            .ssl_ctx = ssl_ctx,
            .certificate = certificate,
            .local_peer_id = peer_id.PeerId.fromPublicKey(&host_key),
        };
    }

    pub fn deinit(self: *Context) void {
        c.SSL_CTX_free(self.ssl_ctx);
        self.certificate.deinit();
        self.* = undefined;
    }

    pub fn newSsl(self: *const Context, state: *HandshakeState) Error!*c.SSL {
        const ssl = c.SSL_new(self.ssl_ctx) orelse return error.OpenSslFailed;
        errdefer c.SSL_free(ssl);
        if (c.SSL_set_app_data(ssl, state) != 1) return error.OpenSslFailed;
        return ssl;
    }
};

pub fn handshakeState(ssl: *c.SSL) ?*HandshakeState {
    const raw = c.SSL_get_app_data(ssl) orelse return null;
    return @ptrCast(@alignCast(raw));
}

fn verifyCallback(ssl: ?*c.SSL, out_alert: [*c]u8) callconv(.c) c.enum_ssl_verify_result_t {
    out_alert.* = c.SSL_AD_BAD_CERTIFICATE;
    const handle = ssl orelse return c.ssl_verify_invalid;
    const state = handshakeState(handle) orelse return c.ssl_verify_invalid;
    const chain = c.SSL_get0_peer_certificates(handle) orelse return c.ssl_verify_invalid;
    if (c.sk_CRYPTO_BUFFER_num(chain) != 1) return c.ssl_verify_invalid;
    const buffer = c.sk_CRYPTO_BUFFER_value(chain, 0) orelse return c.ssl_verify_invalid;
    const der = c.CRYPTO_BUFFER_data(buffer)[0..c.CRYPTO_BUFFER_len(buffer)];
    state.peer_id = verify.verifyDer(der, state.now_unix) catch |err| {
        state.failure = err;
        out_alert.* = switch (err) {
            error.CertificateExpired => c.SSL_AD_CERTIFICATE_EXPIRED,
            else => c.SSL_AD_BAD_CERTIFICATE,
        };
        return c.ssl_verify_invalid;
    };
    return c.ssl_verify_ok;
}

fn alpnSelect(
    ssl: ?*c.SSL,
    out: [*c][*c]const u8,
    out_len: [*c]u8,
    in: [*c]const u8,
    in_len: c_uint,
    arg: ?*anyopaque,
) callconv(.c) c_int {
    _ = ssl;
    _ = arg;
    const result = c.SSL_select_next_proto(
        @ptrCast(out),
        out_len,
        in,
        in_len,
        &alpn_protos,
        alpn_protos.len,
    );
    if (result == c.OPENSSL_NPN_NEGOTIATED) return c.SSL_TLSEXT_ERR_OK;
    return c.SSL_TLSEXT_ERR_ALERT_FATAL;
}

test {
    _ = @import("context_test.zig");
}
