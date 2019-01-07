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

var HASH384 = function(ctx) {
    "use strict";

    var HASH384 = function() {
        this.length = [];
        this.h = [];
        this.w = [];
        this.init();
    };

    HASH384.prototype = {

        /* basic transformation step */
        transform: function() {
            var a, b, c, d, e, f, g, hh, t1, t2, j;

            for (j = 16; j < 80; j++) {
                this.w[j] = HASH384.theta1(this.w[j - 2]).add(this.w[j - 7]).add(HASH384.theta0(this.w[j - 15])).add(this.w[j - 16]);
            }

            a = this.h[0].copy();
            b = this.h[1].copy();
            c = this.h[2].copy();
            d = this.h[3].copy();
            e = this.h[4].copy();
            f = this.h[5].copy();
            g = this.h[6].copy();
            hh = this.h[7].copy();

            /* 80 times - mush it up */
            for (j = 0; j < 80; j++) {
                t1 = hh.copy();
                t1.add(HASH384.Sig1(e)).add(HASH384.Ch(e, f, g)).add(HASH384.HK[j]).add(this.w[j]);

                t2 = HASH384.Sig0(a);
                t2.add(HASH384.Maj(a, b, c));
                hh = g;
                g = f;
                f = e;
                e = d.copy();
                e.add(t1);

                d = c;
                c = b;
                b = a;
                a = t1.copy();
                a.add(t2);
            }

            this.h[0].add(a);
            this.h[1].add(b);
            this.h[2].add(c);
            this.h[3].add(d);
            this.h[4].add(e);
            this.h[5].add(f);
            this.h[6].add(g);
            this.h[7].add(hh);
        },

        /* Initialize Hash function */
        init: function() {
            var i;

            for (i = 0; i < 80; i++) {
                this.w[i] = new ctx.UInt64(0, 0);
            }
            this.length[0] = new ctx.UInt64(0, 0);
            this.length[1] = new ctx.UInt64(0, 0);
            this.h[0] = HASH384.H[0].copy();
            this.h[1] = HASH384.H[1].copy();
            this.h[2] = HASH384.H[2].copy();
            this.h[3] = HASH384.H[3].copy();
            this.h[4] = HASH384.H[4].copy();
            this.h[5] = HASH384.H[5].copy();
            this.h[6] = HASH384.H[6].copy();
            this.h[7] = HASH384.H[7].copy();
        },

        /* process a single byte */
        process: function(byt) {
            var cnt, e;

            cnt = (this.length[0].bot >>> 6) % 16;
            this.w[cnt].shlb();
            this.w[cnt].bot |= (byt & 0xFF);

            e = new ctx.UInt64(0, 8);
            this.length[0].add(e);

            if (this.length[0].top === 0 && this.length[0].bot == 0) {
                e = new ctx.UInt64(0, 1);
                this.length[1].add(e);
            }

            if ((this.length[0].bot % 1024) === 0) {
                this.transform();
            }
        },

        /* process an array of bytes */
        process_array: function(b) {
            for (var i = 0; i < b.length; i++) {
                this.process(b[i]);
            }
        },

        /* process a 32-bit integer */
        process_num: function(n) {
            this.process((n >> 24) & 0xff);
            this.process((n >> 16) & 0xff);
            this.process((n >> 8) & 0xff);
            this.process(n & 0xff);
        },

        /* pad message and finish - supply digest */
        hash: function() {
            var digest = [],
                len0, len1,
                i;

            len0 = this.length[0].copy();
            len1 = this.length[1].copy();
            this.process(0x80);
            while ((this.length[0].bot % 1024) != 896) {
                this.process(0);
            }

            this.w[14] = len1;
            this.w[15] = len0;
            this.transform();

            /* convert to bytes */
            for (i = 0; i < HASH384.len; i++) {
                digest[i] = HASH384.R(8 * (7 - i % 8), this.h[i >>> 3]).bot & 0xff;
            }

            this.init();

            return digest;
        }
    };


    /* static  functions */
    HASH384.S = function(n, x) {
        if (n == 0) {
            return x;
        }

        if (n < 32) {
            return new ctx.UInt64((x.top >>> n) | (x.bot << (32 - n)), (x.bot >>> n) | (x.top << (32 - n)));
        } else {
            return new ctx.UInt64((x.bot >>> (n - 32)) | (x.top << (64 - n)), (x.top >>> (n - 32)) | (x.bot << (64 - n)));
        }

    };

    HASH384.R = function(n, x) {
        if (n == 0) {
            return x;
        }

        if (n < 32) {
            return new ctx.UInt64((x.top >>> n), (x.bot >>> n | (x.top << (32 - n))));
        } else {
            return new ctx.UInt64(0, x.top >>> (n - 32));
        }
    };

    HASH384.Ch = function(x, y, z) {
        return new ctx.UInt64((x.top & y.top) ^ (~(x.top) & z.top), (x.bot & y.bot) ^ (~(x.bot) & z.bot));
    };

    HASH384.Maj = function(x, y, z) {
        return new ctx.UInt64((x.top & y.top) ^ (x.top & z.top) ^ (y.top & z.top), (x.bot & y.bot) ^ (x.bot & z.bot) ^ (y.bot & z.bot));
    };

    HASH384.Sig0 = function(x) {
        var r1 = HASH384.S(28, x),
            r2 = HASH384.S(34, x),
            r3 = HASH384.S(39, x);

        return new ctx.UInt64(r1.top ^ r2.top ^ r3.top, r1.bot ^ r2.bot ^ r3.bot);
    };

    HASH384.Sig1 = function(x) {
        var r1 = HASH384.S(14, x),
            r2 = HASH384.S(18, x),
            r3 = HASH384.S(41, x);

        return new ctx.UInt64(r1.top ^ r2.top ^ r3.top, r1.bot ^ r2.bot ^ r3.bot);
    };

    HASH384.theta0 = function(x) {
        var r1 = HASH384.S(1, x),
            r2 = HASH384.S(8, x),
            r3 = HASH384.R(7, x);

        return new ctx.UInt64(r1.top ^ r2.top ^ r3.top, r1.bot ^ r2.bot ^ r3.bot);
    };

    HASH384.theta1 = function(x) {
        var r1 = HASH384.S(19, x),
            r2 = HASH384.S(61, x),
            r3 = HASH384.R(6, x);

        return new ctx.UInt64(r1.top ^ r2.top ^ r3.top, r1.bot ^ r2.bot ^ r3.bot);
    };

    HASH384.len = 48;

    HASH384.H = [new ctx.UInt64(0xcbbb9d5d, 0xc1059ed8), new ctx.UInt64(0x629a292a, 0x367cd507),
        new ctx.UInt64(0x9159015a, 0x3070dd17), new ctx.UInt64(0x152fecd8, 0xf70e5939),
        new ctx.UInt64(0x67332667, 0xffc00b31), new ctx.UInt64(0x8eb44a87, 0x68581511),
        new ctx.UInt64(0xdb0c2e0d, 0x64f98fa7), new ctx.UInt64(0x47b5481d, 0xbefa4fa4)
    ];

    HASH384.HK = [new ctx.UInt64(0x428a2f98, 0xd728ae22), new ctx.UInt64(0x71374491, 0x23ef65cd),
        new ctx.UInt64(0xb5c0fbcf, 0xec4d3b2f), new ctx.UInt64(0xe9b5dba5, 0x8189dbbc),
        new ctx.UInt64(0x3956c25b, 0xf348b538), new ctx.UInt64(0x59f111f1, 0xb605d019),
        new ctx.UInt64(0x923f82a4, 0xaf194f9b), new ctx.UInt64(0xab1c5ed5, 0xda6d8118),
        new ctx.UInt64(0xd807aa98, 0xa3030242), new ctx.UInt64(0x12835b01, 0x45706fbe),
        new ctx.UInt64(0x243185be, 0x4ee4b28c), new ctx.UInt64(0x550c7dc3, 0xd5ffb4e2),
        new ctx.UInt64(0x72be5d74, 0xf27b896f), new ctx.UInt64(0x80deb1fe, 0x3b1696b1),
        new ctx.UInt64(0x9bdc06a7, 0x25c71235), new ctx.UInt64(0xc19bf174, 0xcf692694),
        new ctx.UInt64(0xe49b69c1, 0x9ef14ad2), new ctx.UInt64(0xefbe4786, 0x384f25e3),
        new ctx.UInt64(0x0fc19dc6, 0x8b8cd5b5), new ctx.UInt64(0x240ca1cc, 0x77ac9c65),
        new ctx.UInt64(0x2de92c6f, 0x592b0275), new ctx.UInt64(0x4a7484aa, 0x6ea6e483),
        new ctx.UInt64(0x5cb0a9dc, 0xbd41fbd4), new ctx.UInt64(0x76f988da, 0x831153b5),
        new ctx.UInt64(0x983e5152, 0xee66dfab), new ctx.UInt64(0xa831c66d, 0x2db43210),
        new ctx.UInt64(0xb00327c8, 0x98fb213f), new ctx.UInt64(0xbf597fc7, 0xbeef0ee4),
        new ctx.UInt64(0xc6e00bf3, 0x3da88fc2), new ctx.UInt64(0xd5a79147, 0x930aa725),
        new ctx.UInt64(0x06ca6351, 0xe003826f), new ctx.UInt64(0x14292967, 0x0a0e6e70),
        new ctx.UInt64(0x27b70a85, 0x46d22ffc), new ctx.UInt64(0x2e1b2138, 0x5c26c926),
        new ctx.UInt64(0x4d2c6dfc, 0x5ac42aed), new ctx.UInt64(0x53380d13, 0x9d95b3df),
        new ctx.UInt64(0x650a7354, 0x8baf63de), new ctx.UInt64(0x766a0abb, 0x3c77b2a8),
        new ctx.UInt64(0x81c2c92e, 0x47edaee6), new ctx.UInt64(0x92722c85, 0x1482353b),
        new ctx.UInt64(0xa2bfe8a1, 0x4cf10364), new ctx.UInt64(0xa81a664b, 0xbc423001),
        new ctx.UInt64(0xc24b8b70, 0xd0f89791), new ctx.UInt64(0xc76c51a3, 0x0654be30),
        new ctx.UInt64(0xd192e819, 0xd6ef5218), new ctx.UInt64(0xd6990624, 0x5565a910),
        new ctx.UInt64(0xf40e3585, 0x5771202a), new ctx.UInt64(0x106aa070, 0x32bbd1b8),
        new ctx.UInt64(0x19a4c116, 0xb8d2d0c8), new ctx.UInt64(0x1e376c08, 0x5141ab53),
        new ctx.UInt64(0x2748774c, 0xdf8eeb99), new ctx.UInt64(0x34b0bcb5, 0xe19b48a8),
        new ctx.UInt64(0x391c0cb3, 0xc5c95a63), new ctx.UInt64(0x4ed8aa4a, 0xe3418acb),
        new ctx.UInt64(0x5b9cca4f, 0x7763e373), new ctx.UInt64(0x682e6ff3, 0xd6b2b8a3),
        new ctx.UInt64(0x748f82ee, 0x5defb2fc), new ctx.UInt64(0x78a5636f, 0x43172f60),
        new ctx.UInt64(0x84c87814, 0xa1f0ab72), new ctx.UInt64(0x8cc70208, 0x1a6439ec),
        new ctx.UInt64(0x90befffa, 0x23631e28), new ctx.UInt64(0xa4506ceb, 0xde82bde9),
        new ctx.UInt64(0xbef9a3f7, 0xb2c67915), new ctx.UInt64(0xc67178f2, 0xe372532b),
        new ctx.UInt64(0xca273ece, 0xea26619c), new ctx.UInt64(0xd186b8c7, 0x21c0c207),
        new ctx.UInt64(0xeada7dd6, 0xcde0eb1e), new ctx.UInt64(0xf57d4f7f, 0xee6ed178),
        new ctx.UInt64(0x06f067aa, 0x72176fba), new ctx.UInt64(0x0a637dc5, 0xa2c898a6),
        new ctx.UInt64(0x113f9804, 0xbef90dae), new ctx.UInt64(0x1b710b35, 0x131c471b),
        new ctx.UInt64(0x28db77f5, 0x23047d84), new ctx.UInt64(0x32caab7b, 0x40c72493),
        new ctx.UInt64(0x3c9ebe0a, 0x15c9bebc), new ctx.UInt64(0x431d67c4, 0x9c100d4c),
        new ctx.UInt64(0x4cc5d4be, 0xcb3e42b6), new ctx.UInt64(0x597f299c, 0xfc657e2a),
        new ctx.UInt64(0x5fcb6fab, 0x3ad6faec), new ctx.UInt64(0x6c44198c, 0x4a475817)
    ];

    return HASH384;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        HASH384: HASH384
    };
}
