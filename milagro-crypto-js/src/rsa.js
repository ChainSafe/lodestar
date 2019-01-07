/*
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

/* RSA API Functions */
var RSA,
    rsa_private_key,
    rsa_public_key;

RSA = function(ctx) {
    "use strict";

    var RSA = {
        RFS: ctx.BIG.MODBYTES * ctx.FF.FFLEN,
        SHA256: 32,
        SHA384: 48,
        SHA512: 64,

        HASH_TYPE: 32,

        /* SHAXXX identifier strings */
        SHA256ID: [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20],
        SHA384ID: [0x30, 0x41, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02, 0x05, 0x00, 0x04, 0x30],
        SHA512ID: [0x30, 0x51, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03, 0x05, 0x00, 0x04, 0x40],

        bytestohex: function(b) {
            var s = "",
                len = b.length,
                ch, i;

            for (i = 0; i < len; i++) {
                ch = b[i];
                s += ((ch >>> 4) & 15).toString(16);
                s += (ch & 15).toString(16);

            }
            return s;
        },

        bytestostring: function(b) {
            var s = "",
                i;

            for (i = 0; i < b.length; i++) {
                s += String.fromCharCode(b[i]);
            }

            return s;
        },

        stringtobytes: function(s) {
            var b = [],
                i;

            for (i = 0; i < s.length; i++) {
                b.push(s.charCodeAt(i));
            }

            return b;
        },

        hashit: function(sha, A, n) {
            var R = [],
                H;

            if (sha == this.SHA256) {
                H = new ctx.HASH256();

                if (A != null) {
                    H.process_array(A);
                }

                if (n >= 0) {
                    H.process_num(n);
                }

                R = H.hash();
            } else if (sha == this.SHA384) {
                H = new ctx.HASH384();

                if (A != null) {
                    H.process_array(A);
                }

                if (n >= 0) {
                    H.process_num(n);
                }

                R = H.hash();
            } else if (sha == this.SHA512) {
                H = new ctx.HASH512();

                if (A != null) {
                    H.process_array(A);
                }

                if (n >= 0) {
                    H.process_num(n);
                }

                R = H.hash();
            }

            return R;
        },

        /* IEEE1363 A16.11/A16.12 more or less */
        KEY_PAIR: function(rng, e, PRIV, PUB) {
            var n = PUB.n.length >> 1,
                t = new ctx.FF(n),
                p1 = new ctx.FF(n),
                q1 = new ctx.FF(n);

            for (;;) {
                PRIV.p.random(rng);

                while (PRIV.p.lastbits(2) != 3) {
                    PRIV.p.inc(1);
                }

                while (!ctx.FF.prime(PRIV.p, rng)) {
                    PRIV.p.inc(4);
                }

                p1.copy(PRIV.p);
                p1.dec(1);

                if (p1.cfactor(e)) {
                    continue;
                }

                break;
            }

            for (;;) {
                PRIV.q.random(rng);

                while (PRIV.q.lastbits(2) != 3) {
                    PRIV.q.inc(1);
                }

                while (!ctx.FF.prime(PRIV.q, rng)) {
                    PRIV.q.inc(4);
                }

                q1.copy(PRIV.q);
                q1.dec(1);

                if (q1.cfactor(e)) {
                    continue;
                }

                break;
            }

            PUB.n = ctx.FF.mul(PRIV.p, PRIV.q);
            PUB.e = e;

            t.copy(p1);
            t.shr();
            PRIV.dp.set(e);
            PRIV.dp.invmodp(t);
            if (PRIV.dp.parity() === 0) {
                PRIV.dp.add(t);
            }
            PRIV.dp.norm();

            t.copy(q1);
            t.shr();
            PRIV.dq.set(e);
            PRIV.dq.invmodp(t);
            if (PRIV.dq.parity() === 0) {
                PRIV.dq.add(t);
            }
            PRIV.dq.norm();

            PRIV.c.copy(PRIV.p);
            PRIV.c.invmodp(PRIV.q);

            return;
        },

        /* Mask Generation Function */
        MGF1: function(sha, Z, olen, K) {
            var hlen = sha,
                B = [],
                k = 0,
                counter, cthreshold, i;

            for (i = 0; i < K.length; i++) {
                K[i] = 0;
            }

            cthreshold = Math.floor(olen / hlen);
            if (olen % hlen !== 0) {
                cthreshold++;
            }

            for (counter = 0; counter < cthreshold; counter++) {
                B = this.hashit(sha, Z, counter);

                if (k + hlen > olen) {
                    for (i = 0; i < olen % hlen; i++) {
                        K[k++] = B[i];
                    }
                } else {
                    for (i = 0; i < hlen; i++) {
                        K[k++] = B[i];
                    }
                }
            }
        },

        PKCS15: function(sha, m, w) {
            var olen = ctx.FF.FF_BITS / 8,
                hlen = sha,
                idlen = 19,
                H, i, j;

            if (olen < idlen + hlen + 10) {
                return false;
            }

            H = this.hashit(sha, m, -1);

            for (i = 0; i < w.length; i++) {
                w[i] = 0;
            }

            i = 0;
            w[i++] = 0;
            w[i++] = 1;
            for (j = 0; j < olen - idlen - hlen - 3; j++) {
                w[i++] = 0xFF;
            }
            w[i++] = 0;

            if (hlen == this.SHA256) {
                for (j = 0; j < idlen; j++) {
                    w[i++] = this.SHA256ID[j];
                }
            } else if (hlen == this.SHA384) {
                for (j = 0; j < idlen; j++) {
                    w[i++] = this.SHA384ID[j];
                }
            } else if (hlen == this.SHA512) {
                for (j = 0; j < idlen; j++) {
                    w[i++] = this.SHA512ID[j];
                }
            }

            for (j = 0; j < hlen; j++) {
                w[i++] = H[j];
            }

            return true;
        },

        /* OAEP Message Encoding for Encryption */
        OAEP_ENCODE: function(sha, m, rng, p) {
            var olen = RSA.RFS - 1,
                mlen = m.length,
                SEED = [],
                DBMASK = [],
                f = [],
                hlen,
                seedlen,
                slen,
                i, d, h;

            seedlen = hlen = sha;

            if (mlen > olen - hlen - seedlen - 1) {
                return null;
            }

            h = this.hashit(sha, p, -1);
            for (i = 0; i < hlen; i++) {
                f[i] = h[i];
            }

            slen = olen - mlen - hlen - seedlen - 1;

            for (i = 0; i < slen; i++) {
                f[hlen + i] = 0;
            }
            f[hlen + slen] = 1;
            for (i = 0; i < mlen; i++) {
                f[hlen + slen + 1 + i] = m[i];
            }

            for (i = 0; i < seedlen; i++) {
                SEED[i] = rng.getByte();
            }
            this.MGF1(sha, SEED, olen - seedlen, DBMASK);

            for (i = 0; i < olen - seedlen; i++) {
                DBMASK[i] ^= f[i];
            }
            this.MGF1(sha, DBMASK, seedlen, f);

            for (i = 0; i < seedlen; i++) {
                f[i] ^= SEED[i];
            }

            for (i = 0; i < olen - seedlen; i++) {
                f[i + seedlen] = DBMASK[i];
            }

            /* pad to length RFS */
            d = 1;
            for (i = RSA.RFS - 1; i >= d; i--) {
                f[i] = f[i - d];
            }
            for (i = d - 1; i >= 0; i--) {
                f[i] = 0;
            }

            return f;
        },

        /* OAEP Message Decoding for Decryption */
        OAEP_DECODE: function(sha, p, f) {
            var olen = RSA.RFS - 1,
                SEED = [],
                CHASH = [],
                DBMASK = [],
                comp,
                hlen,
                seedlen,
                x, t, d, i, k, h, r;

            seedlen = hlen = sha;

            if (olen < seedlen + hlen + 1) {
                return null;
            }

            for (i = 0; i < olen - seedlen; i++) {
                DBMASK[i] = 0;
            }

            if (f.length < RSA.RFS) {
                d = RSA.RFS - f.length;
                for (i = RSA.RFS - 1; i >= d; i--) {
                    f[i] = f[i - d];
                }
                for (i = d - 1; i >= 0; i--) {
                    f[i] = 0;
                }
            }

            h = this.hashit(sha, p, -1);
            for (i = 0; i < hlen; i++) {
                CHASH[i] = h[i];
            }

            x = f[0];

            for (i = seedlen; i < olen; i++) {
                DBMASK[i - seedlen] = f[i + 1];
            }

            this.MGF1(sha, DBMASK, seedlen, SEED);
            for (i = 0; i < seedlen; i++) {
                SEED[i] ^= f[i + 1];
            }
            this.MGF1(sha, SEED, olen - seedlen, f);
            for (i = 0; i < olen - seedlen; i++) {
                DBMASK[i] ^= f[i];
            }

            comp = true;
            for (i = 0; i < hlen; i++) {
                if (CHASH[i] != DBMASK[i]) {
                    comp = false;
                }
            }

            for (i = 0; i < olen - seedlen - hlen; i++) {
                DBMASK[i] = DBMASK[i + hlen];
            }

            for (i = 0; i < hlen; i++) {
                SEED[i] = CHASH[i] = 0;
            }

            for (k = 0;; k++) {
                if (k >= olen - seedlen - hlen) {
                    return null;
                }

                if (DBMASK[k] !== 0) {
                    break;
                }
            }

            t = DBMASK[k];

            if (!comp || x !== 0 || t != 0x01) {
                for (i = 0; i < olen - seedlen; i++) {
                    DBMASK[i] = 0;
                }
                return null;
            }

            r = [];

            for (i = 0; i < olen - seedlen - hlen - k - 1; i++) {
                r[i] = DBMASK[i + k + 1];
            }

            for (i = 0; i < olen - seedlen; i++) {
                DBMASK[i] = 0;
            }

            return r;
        },

        /* destroy the Private Key structure */
        PRIVATE_KEY_KILL: function(PRIV) {
            PRIV.p.zero();
            PRIV.q.zero();
            PRIV.dp.zero();
            PRIV.dq.zero();
            PRIV.c.zero();
        },

        /* RSA encryption with the public key */
        ENCRYPT: function(PUB, F, G) {
            var n = PUB.n.getlen(),
                f = new ctx.FF(n);

            ctx.FF.fromBytes(f, F);

            f.power(PUB.e, PUB.n);

            f.toBytes(G);
        },

        /* RSA decryption with the private key */
        DECRYPT: function(PRIV, G, F) {
            var n = PRIV.p.getlen(),
                g = new ctx.FF(2 * n),
                jp, jq, t;

            ctx.FF.fromBytes(g, G);

            jp = g.dmod(PRIV.p);
            jq = g.dmod(PRIV.q);

            jp.skpow(PRIV.dp, PRIV.p);
            jq.skpow(PRIV.dq, PRIV.q);

            g.zero();
            g.dscopy(jp);
            jp.mod(PRIV.q);
            if (ctx.FF.comp(jp, jq) > 0) {
                jq.add(PRIV.q);
            }
            jq.sub(jp);
            jq.norm();

            t = ctx.FF.mul(PRIV.c, jq);
            jq = t.dmod(PRIV.q);

            t = ctx.FF.mul(jq, PRIV.p);
            g.add(t);
            g.norm();

            g.toBytes(F);
        }
    };

    return RSA;
};

rsa_private_key = function(ctx) {
    "use strict";

    var rsa_private_key = function(n) {
        this.p = new ctx.FF(n);
        this.q = new ctx.FF(n);
        this.dp = new ctx.FF(n);
        this.dq = new ctx.FF(n);
        this.c = new ctx.FF(n);
    };

    return rsa_private_key;
};

rsa_public_key = function(ctx) {
    "use strict";

    var rsa_public_key = function(m) {
        this.e = 0;
        this.n = new ctx.FF(m);
    };

    return rsa_public_key;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        RSA: RSA,
        rsa_private_key: rsa_private_key,
        rsa_public_key: rsa_public_key
    };
}
