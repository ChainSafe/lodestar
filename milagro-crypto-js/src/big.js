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

/* AMCL BIG number class */
var BIG,
    DBIG;

BIG = function(ctx) {
    "use strict";

    /* General purpose Constructor */
    var BIG = function(x) {
        this.w = new Array(BIG.NLEN);

        switch (typeof(x)) {
            case "object":
                this.copy(x);
                break;

            case "number":
                this.zero();
                this.w[0] = x;
                break;

            default:
                this.zero();
        }
    };

    BIG.CHUNK = 32;
    BIG.MODBYTES = ctx.config["@NB"];
    BIG.BASEBITS = ctx.config["@BASE"];
    BIG.NLEN = (1 + (Math.floor((8 * BIG.MODBYTES - 1) / BIG.BASEBITS)));
    BIG.DNLEN = 2 * BIG.NLEN;
    BIG.BMASK = (1 << BIG.BASEBITS) - 1;
    BIG.BIGBITS = (8 * BIG.MODBYTES);
    BIG.NEXCESS = (1 << (BIG.CHUNK - BIG.BASEBITS - 1));
    BIG.MODINV = (Math.pow(2, -BIG.BASEBITS));

    BIG.prototype = {
        /* set to zero */
        zero: function() {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] = 0;
            }

            return this;
        },

        /* set to one */
        one: function() {
            var i;

            this.w[0] = 1;
            for (i = 1; i < BIG.NLEN; i++) {
                this.w[i] = 0;
            }

            return this;
        },

        get: function(i) {
            return this.w[i];
        },

        set: function(i, x) {
            this.w[i] = x;
        },

        /* test for zero */
        iszilch: function() {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                if (this.w[i] !== 0) {
                    return false;
                }
            }

            return true;
        },

        /* test for unity */
        isunity: function() {
            var i;

            for (i = 1; i < BIG.NLEN; i++) {
                if (this.w[i] !== 0) {
                    return false;
                }
            }

            if (this.w[0] != 1) {
                return false;
            }

            return true;
        },

        /* Conditional swap of two BIGs depending on d using XOR - no branches */
        cswap: function(b, d) {
            var c = d,
                t, i;

            c = ~(c - 1);

            for (i = 0; i < BIG.NLEN; i++) {
                t = c & (this.w[i] ^ b.w[i]);
                this.w[i] ^= t;
                b.w[i] ^= t;
            }
        },

        /* Conditional move of BIG depending on d using XOR - no branches */
        cmove: function(b, d) {
            var c = d,
                i;

            c = ~(c - 1);

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] ^= (this.w[i] ^ b.w[i]) & c;
            }
        },

        /* copy from another BIG */
        copy: function(y) {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] = y.w[i];
            }

            return this;
        },

        /* copy from bottom half of ctx.DBIG */
        hcopy: function(y) {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] = y.w[i];
            }

            return this;
        },

        /* copy from ROM */
        rcopy: function(y) {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] = y[i];
            }

            return this;
        },

        xortop: function(x) {
            this.w[BIG.NLEN - 1] ^= x;
        },

        ortop: function(x) {
            this.w[BIG.NLEN - 1] |= x;
        },

        /* normalise BIG - force all digits < 2^BASEBITS */
        norm: function() {
            var carry = 0,
                d, i;

            for (i = 0; i < BIG.NLEN - 1; i++) {
                d = this.w[i] + carry;
                this.w[i] = d & BIG.BMASK;
                carry = d >> BIG.BASEBITS;
            }

            this.w[BIG.NLEN - 1] = (this.w[BIG.NLEN - 1] + carry);

            return (this.w[BIG.NLEN - 1] >> ((8 * BIG.MODBYTES) % BIG.BASEBITS));
        },

        /* quick shift right by less than a word */
        fshr: function(k) {
            var r, i;

            /* shifted out part */
            r = this.w[0] & ((1 << k) - 1);

            for (i = 0; i < BIG.NLEN - 1; i++) {
                this.w[i] = (this.w[i] >> k) | ((this.w[i + 1] << (BIG.BASEBITS - k)) & BIG.BMASK);
            }

            this.w[BIG.NLEN - 1] = this.w[BIG.NLEN - 1] >> k;

            return r;
        },

        /* General shift right by k bits */
        shr: function(k) {
            var n = k % BIG.BASEBITS,
                m = Math.floor(k / BIG.BASEBITS),
                i;

            for (i = 0; i < BIG.NLEN - m - 1; i++) {
                this.w[i] = (this.w[m + i] >> n) | ((this.w[m + i + 1] << (BIG.BASEBITS - n)) & BIG.BMASK);
            }

            this.w[BIG.NLEN - m - 1] = this.w[BIG.NLEN - 1] >> n;

            for (i = BIG.NLEN - m; i < BIG.NLEN; i++) {
                this.w[i] = 0;
            }

            return this;
        },

        /* quick shift left by less than a word */
        fshl: function(k) {
            var i;

            this.w[BIG.NLEN - 1] = ((this.w[BIG.NLEN - 1] << k)) | (this.w[BIG.NLEN - 2] >> (BIG.BASEBITS - k));

            for (i = BIG.NLEN - 2; i > 0; i--) {
                this.w[i] = ((this.w[i] << k) & BIG.BMASK) | (this.w[i - 1] >> (BIG.BASEBITS - k));
            }

            this.w[0] = (this.w[0] << k) & BIG.BMASK;

            /* return excess - only used in ff.js */
            return (this.w[BIG.NLEN - 1] >> ((8 * BIG.MODBYTES) % BIG.BASEBITS));
        },

        /* General shift left by k bits */
        shl: function(k) {
            var n = k % BIG.BASEBITS,
                m = Math.floor(k / BIG.BASEBITS),
                i;

            this.w[BIG.NLEN - 1] = (this.w[BIG.NLEN - 1 - m] << n);

            if (BIG.NLEN > m + 2) {
                this.w[BIG.NLEN - 1] |= (this.w[BIG.NLEN - m - 2] >> (BIG.BASEBITS - n));
            }

            for (i = BIG.NLEN - 2; i > m; i--) {
                this.w[i] = ((this.w[i - m] << n) & BIG.BMASK) | (this.w[i - m - 1] >> (BIG.BASEBITS - n));
            }

            this.w[m] = (this.w[0] << n) & BIG.BMASK;

            for (i = 0; i < m; i++) {
                this.w[i] = 0;
            }

            return this;
        },

        /* return length in bits */
        nbits: function() {
            var k = BIG.NLEN - 1,
                bts, c;

            this.norm();

            while (k >= 0 && this.w[k] === 0) {
                k--;
            }

            if (k < 0) {
                return 0;
            }

            bts = BIG.BASEBITS * k;
            c = this.w[k];

            while (c !== 0) {
                c = Math.floor(c / 2);
                bts++;
            }

            return bts;
        },

        /* convert this to string */
        toString: function() {
            var s = "",
                len = this.nbits(),
                b, i;

            if (len % 4 === 0) {
                len = Math.floor(len / 4);
            } else {
                len = Math.floor(len / 4);
                len++;
            }

            if (len < BIG.MODBYTES * 2) {
                len = BIG.MODBYTES * 2;
            }

            for (i = len - 1; i >= 0; i--) {
                b = new BIG(0);
                b.copy(this);
                b.shr(i * 4);
                s += (b.w[0] & 15).toString(16);
            }

            return s;
        },

        /* this+=y */
        add: function(y) {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] += y.w[i];
            }

            return this;
        },


        /* this|=y */
        or: function(y) {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] |= y.w[i];
            }

            return this;
        },


        /* return this+x */
        plus: function(x) {
            var s = new BIG(0),
                i;

            for (i = 0; i < BIG.NLEN; i++) {
                s.w[i] = this.w[i] + x.w[i];
            }

            return s;
        },

        /* this+=i, where i is int */
        inc: function(i) {
            this.norm();
            this.w[0] += i;
            return this;
        },

        /* this-=y */
        sub: function(y) {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] -= y.w[i];
            }

            return this;
        },

        /* reverse subtract this=x-this */
        rsub: function(x) {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] = x.w[i] - this.w[i];
            }

            return this;
        },

        /* this-=i, where i is int */
        dec: function(i) {
            this.norm();
            this.w[0] -= i;
            return this;
        },

        /* return this-x */
        minus: function(x) {
            var d = new BIG(0),
                i;

            for (i = 0; i < BIG.NLEN; i++) {
                d.w[i] = this.w[i] - x.w[i];
            }

            return d;
        },

        /* multiply by small integer */
        imul: function(c) {
            var i;

            for (i = 0; i < BIG.NLEN; i++) {
                this.w[i] *= c;
            }

            return this;
        },

        /* convert this BIG to byte array */
        tobytearray: function(b, n) {
            var c = new BIG(0),
                i;

            this.norm();
            c.copy(this);

            for (i = BIG.MODBYTES - 1; i >= 0; i--) {
                b[i + n] = c.w[0] & 0xff;
                c.fshr(8);
            }

            return this;
        },

        /* convert this to byte array */
        toBytes: function(b) {
            this.tobytearray(b, 0);
        },

        /* set this[i]+=x*y+c, and return high part */
        muladd: function(x, y, c, i) {
            var prod = x * y + c + this.w[i];
            this.w[i] = prod & BIG.BMASK;
            return ((prod - this.w[i]) * BIG.MODINV);
        },

        /* multiply by larger int */
        pmul: function(c) {
            var carry = 0,
                ak, i;

            for (i = 0; i < BIG.NLEN; i++) {
                ak = this.w[i];
                this.w[i] = 0;
                carry = this.muladd(ak, c, carry, i);
            }

            return carry;
        },

        /* multiply by still larger int - results requires a ctx.DBIG */
        pxmul: function(c) {
            var m = new ctx.DBIG(0),
                carry = 0,
                j;

            for (j = 0; j < BIG.NLEN; j++) {
                carry = m.muladd(this.w[j], c, carry, j);
            }

            m.w[BIG.NLEN] = carry;

            return m;
        },

        /* divide by 3 */
        div3: function() {
            var carry = 0,
                ak, base, i;

            this.norm();
            base = (1 << BIG.BASEBITS);

            for (i = BIG.NLEN - 1; i >= 0; i--) {
                ak = (carry * base + this.w[i]);
                this.w[i] = Math.floor(ak / 3);
                carry = ak % 3;
            }
            return carry;
        },

        /* set x = x mod 2^m */
        mod2m: function(m) {
            var i, wd, bt, msk;

            wd = Math.floor(m / BIG.BASEBITS);
            bt = m % BIG.BASEBITS;
            msk = (1 << bt) - 1;
            this.w[wd] &= msk;

            for (i = wd + 1; i < BIG.NLEN; i++) {
                this.w[i] = 0;
            }
        },

        /* a=1/a mod 2^256. This is very fast! */
        invmod2m: function() {
            var U = new BIG(0),
                b = new BIG(0),
                c = new BIG(0),
                i, t1, t2;

            U.inc(BIG.invmod256(this.lastbits(8)));

            for (i = 8; i < BIG.BIGBITS; i <<= 1) {
                U.norm();
                b.copy(this);
                b.mod2m(i);
                t1 = BIG.smul(U, b);
                t1.shr(i);
                c.copy(this);
                c.shr(i);
                c.mod2m(i);

                t2 = BIG.smul(U, c);
                t2.mod2m(i);
                t1.add(t2);
                t1.norm();
                b = BIG.smul(t1, U);
                t1.copy(b);
                t1.mod2m(i);

                t2.one();
                t2.shl(i);
                t1.rsub(t2);
                t1.norm();
                t1.shl(i);
                U.add(t1);
            }

            U.mod2m(BIG.BIGBITS);
            this.copy(U);
            this.norm();
        },

        /* reduce this mod m */
        mod: function(m) {
            var k = 0,
                r = new BIG(0);

            this.norm();

            if (BIG.comp(this, m) < 0) {
                return;
            }

            do {
                m.fshl(1);
                k++;
            } while (BIG.comp(this, m) >= 0);

            while (k > 0) {
                m.fshr(1);

                r.copy(this);
                r.sub(m);
                r.norm();
                this.cmove(r, (1 - ((r.w[BIG.NLEN - 1] >> (BIG.CHUNK - 1)) & 1)));

                k--;
            }
        },
        /* this/=m */
        div: function(m) {
            var k = 0,
                d = 0,
                e = new BIG(1),
                b = new BIG(0),
                r = new BIG(0);

            this.norm();
            b.copy(this);
            this.zero();

            while (BIG.comp(b, m) >= 0) {
                e.fshl(1);
                m.fshl(1);
                k++;
            }

            while (k > 0) {
                m.fshr(1);
                e.fshr(1);

                r.copy(b);
                r.sub(m);
                r.norm();
                d = (1 - ((r.w[BIG.NLEN - 1] >> (BIG.CHUNK - 1)) & 1));
                b.cmove(r, d);
                r.copy(this);
                r.add(e);
                r.norm();
                this.cmove(r, d);

                k--;
            }
        },
        /* return parity of this */
        parity: function() {
            return this.w[0] % 2;
        },

        /* return n-th bit of this */
        bit: function(n) {
            if ((this.w[Math.floor(n / BIG.BASEBITS)] & (1 << (n % BIG.BASEBITS))) > 0) {
                return 1;
            } else {
                return 0;
            }
        },

        /* return last n bits of this */
        lastbits: function(n) {
            var msk = (1 << n) - 1;
            this.norm();
            return (this.w[0]) & msk;
        },

        isok: function() {
            var ok = true,
                i;

            for (i = 0; i < BIG.NLEN; i++) {
                if ((this.w[i] >> BIG.BASEBITS) != 0) {
                    ok = false;
                }
            }

            return ok;
        },

        /* Jacobi Symbol (this/p). Returns 0, 1 or -1 */
        jacobi: function(p) {
            var m = 0,
                t = new BIG(0),
                x = new BIG(0),
                n = new BIG(0),
                zilch = new BIG(0),
                one = new BIG(1),
                n8, k;

            if (p.parity() === 0 || BIG.comp(this, zilch) === 0 || BIG.comp(p, one) <= 0) {
                return 0;
            }

            this.norm();
            x.copy(this);
            n.copy(p);
            x.mod(p);

            while (BIG.comp(n, one) > 0) {
                if (BIG.comp(x, zilch) === 0) {
                    return 0;
                }

                n8 = n.lastbits(3);
                k = 0;

                while (x.parity() === 0) {
                    k++;
                    x.shr(1);
                }

                if (k % 2 == 1) {
                    m += (n8 * n8 - 1) / 8;
                }

                m += (n8 - 1) * (x.lastbits(2) - 1) / 4;
                t.copy(n);
                t.mod(x);
                n.copy(x);
                x.copy(t);
                m %= 2;
            }

            if (m === 0) {
                return 1;
            } else {
                return -1;
            }
        },

        /* this=1/this mod p. Binary method */
        invmodp: function(p) {
            var u = new BIG(0),
                v = new BIG(0),
                x1 = new BIG(1),
                x2 = new BIG(0),
                t = new BIG(0),
                one = new BIG(1);

            this.mod(p);
            u.copy(this);
            v.copy(p);

            while (BIG.comp(u, one) !== 0 && BIG.comp(v, one) !== 0) {
                while (u.parity() === 0) {
                    u.fshr(1);
                    if (x1.parity() !== 0) {
                        x1.add(p);
                        x1.norm();
                    }
                    x1.fshr(1);
                }

                while (v.parity() === 0) {
                    v.fshr(1);
                    if (x2.parity() !== 0) {
                        x2.add(p);
                        x2.norm();
                    }
                    x2.fshr(1);
                }

                if (BIG.comp(u, v) >= 0) {
                    u.sub(v);
                    u.norm();
                    if (BIG.comp(x1, x2) >= 0) {
                        x1.sub(x2);
                    } else {
                        t.copy(p);
                        t.sub(x2);
                        x1.add(t);
                    }
                    x1.norm();
                } else {
                    v.sub(u);
                    v.norm();
                    if (BIG.comp(x2, x1) >= 0) {
                        x2.sub(x1);
                    } else {
                        t.copy(p);
                        t.sub(x1);
                        x2.add(t);
                    }
                    x2.norm();
                }
            }

            if (BIG.comp(u, one) === 0) {
                this.copy(x1);
            } else {
                this.copy(x2);
            }
        },

        /* return this^e mod m */
        powmod: function(e, m) {
            var a = new BIG(1),
                z = new BIG(0),
                s = new BIG(0),
                bt;

            this.norm();
            e.norm();
            z.copy(e);
            s.copy(this);

            for (;;) {
                bt = z.parity();
                z.fshr(1);
                if (bt == 1) {
                    a = BIG.modmul(a, s, m);
                }

                if (z.iszilch()) {
                    break;
                }

                s = BIG.modsqr(s, m);
            }

            return a;
        }
    };

    /* convert from byte array to BIG */
    BIG.frombytearray = function(b, n) {
        var m = new BIG(0),
            i;

        for (i = 0; i < BIG.MODBYTES; i++) {
            m.fshl(8);
            m.w[0] += b[i + n] & 0xff;
        }

        return m;
    };

    BIG.fromBytes = function(b) {
        return BIG.frombytearray(b, 0);
    };

    /* return a*b where product fits a BIG */
    BIG.smul = function(a, b) {
        var c = new BIG(0),
            carry, i, j;

        for (i = 0; i < BIG.NLEN; i++) {
            carry = 0;

            for (j = 0; j < BIG.NLEN; j++) {
                if (i + j < BIG.NLEN) {
                    carry = c.muladd(a.w[i], b.w[j], carry, i + j);
                }
            }
        }

        return c;
    };

    /* Compare a and b, return 0 if a==b, -1 if a<b, +1 if a>b. Inputs must be normalised */
    BIG.comp = function(a, b) {
        var i;

        for (i = BIG.NLEN - 1; i >= 0; i--) {
            if (a.w[i] == b.w[i]) {
                continue;
            }

            if (a.w[i] > b.w[i]) {
                return 1;
            } else {
                return -1;
            }
        }

        return 0;
    };

    /* get 8*MODBYTES size random number */
    BIG.random = function(rng) {
        var m = new BIG(0),
            j = 0,
            r = 0,
            i, b;

        /* generate random BIG */
        for (i = 0; i < 8 * BIG.MODBYTES; i++) {
            if (j === 0) {
                r = rng.getByte();
            } else {
                r >>= 1;
            }

            b = r & 1;
            m.shl(1);
            m.w[0] += b;
            j++;
            j &= 7;
        }
        return m;
    };

    /* Create random BIG in portable way, one bit at a time */
    BIG.randomnum = function(q, rng) {
        var d = new ctx.DBIG(0),
            j = 0,
            r = 0,
            i, b, m;

        for (i = 0; i < 2 * q.nbits(); i++) {
            if (j === 0) {
                r = rng.getByte();
            } else {
                r >>= 1;
            }

            b = r & 1;
            d.shl(1);
            d.w[0] += b;
            j++;
            j &= 7;
        }

        m = d.mod(q);

        return m;
    };

    /* return a*b as ctx.DBIG */
    BIG.mul = function(a, b) {
        var c = new ctx.DBIG(0),
            d = [],
            n, s, t, i, k, co;

        for (i = 0; i < BIG.NLEN; i++) {
            d[i] = a.w[i] * b.w[i];
        }

        s = d[0];
        t = s;
        c.w[0] = t;

        for (k = 1; k < BIG.NLEN; k++) {
            s += d[k];
            t = s;
            for (i = k; i >= 1 + Math.floor(k / 2); i--) {
                t += (a.w[i] - a.w[k - i]) * (b.w[k - i] - b.w[i]);
            }
            c.w[k] = t;
        }
        for (k = BIG.NLEN; k < 2 * BIG.NLEN - 1; k++) {
            s -= d[k - BIG.NLEN];
            t = s;
            for (i = BIG.NLEN - 1; i >= 1 + Math.floor(k / 2); i--) {
                t += (a.w[i] - a.w[k - i]) * (b.w[k - i] - b.w[i]);
            }
            c.w[k] = t;
        }

        co = 0;
        for (i = 0; i < BIG.DNLEN - 1; i++) {
            n = c.w[i] + co;
            c.w[i] = n & BIG.BMASK;
            co = (n - c.w[i]) * BIG.MODINV;
        }
        c.w[BIG.DNLEN - 1] = co;

        return c;
    };

    /* return a^2 as ctx.DBIG */
    BIG.sqr = function(a) {
        var c = new ctx.DBIG(0),
            n, t, j, i, co;

        c.w[0] = a.w[0] * a.w[0];

        for (j = 1; j < BIG.NLEN - 1;) {
            t = a.w[j] * a.w[0];
            for (i = 1; i < (j + 1) >> 1; i++) {
                t += a.w[j - i] * a.w[i];
            }
            t += t;
            c.w[j] = t;
            j++;
            t = a.w[j] * a.w[0];
            for (i = 1; i < (j + 1) >> 1; i++) {
                t += a.w[j - i] * a.w[i];
            }
            t += t;
            t += a.w[j >> 1] * a.w[j >> 1];
            c.w[j] = t;
            j++;
        }

        for (j = BIG.NLEN - 1 + BIG.NLEN % 2; j < BIG.DNLEN - 3;) {
            t = a.w[BIG.NLEN - 1] * a.w[j - BIG.NLEN + 1];
            for (i = j - BIG.NLEN + 2; i < (j + 1) >> 1; i++) {
                t += a.w[j - i] * a.w[i];
            }
            t += t;
            c.w[j] = t;
            j++;
            t = a.w[BIG.NLEN - 1] * a.w[j - BIG.NLEN + 1];
            for (i = j - BIG.NLEN + 2; i < (j + 1) >> 1; i++) {
                t += a.w[j - i] * a.w[i];
            }
            t += t;
            t += a.w[j >> 1] * a.w[j >> 1];
            c.w[j] = t;
            j++;
        }

        t = a.w[BIG.NLEN - 2] * a.w[BIG.NLEN - 1];
        t += t;
        c.w[BIG.DNLEN - 3] = t;

        t = a.w[BIG.NLEN - 1] * a.w[BIG.NLEN - 1];
        c.w[BIG.DNLEN - 2] = t;

        co = 0;
        for (i = 0; i < BIG.DNLEN - 1; i++) {
            n = c.w[i] + co;
            c.w[i] = n & BIG.BMASK;
            co = (n - c.w[i]) * BIG.MODINV;
        }
        c.w[BIG.DNLEN - 1] = co;

        return c;
    };

    BIG.monty = function(m, nd, d) {
        var b = new BIG(0),
            v = [],
            dd = [],
            s, c, t, i, k;

        t = d.w[0];
        v[0] = ((t & BIG.BMASK) * nd) & BIG.BMASK;
        t += v[0] * m.w[0];
        c = d.w[1] + (t * BIG.MODINV);
        s = 0;

        for (k = 1; k < BIG.NLEN; k++) {
            t = c + s + v[0] * m.w[k];
            for (i = k - 1; i > Math.floor(k / 2); i--) {
                t += (v[k - i] - v[i]) * (m.w[i] - m.w[k - i]);
            }
            v[k] = ((t & BIG.BMASK) * nd) & BIG.BMASK;
            t += v[k] * m.w[0];
            c = (t * BIG.MODINV) + d.w[k + 1];

            dd[k] = v[k] * m.w[k];
            s += dd[k];
        }

        for (k = BIG.NLEN; k < 2 * BIG.NLEN - 1; k++) {
            t = c + s;
            for (i = BIG.NLEN - 1; i >= 1 + Math.floor(k / 2); i--) {
                t += (v[k - i] - v[i]) * (m.w[i] - m.w[k - i]);
            }
            b.w[k - BIG.NLEN] = t & BIG.BMASK;
            c = ((t - b.w[k - BIG.NLEN]) * BIG.MODINV) + d.w[k + 1];

            s -= dd[k - BIG.NLEN + 1];
        }

        b.w[BIG.NLEN - 1] = c & BIG.BMASK;

        return b;
    };

    /* return a*b mod m */
    BIG.modmul = function(a, b, m) {
        var d;

        a.mod(m);
        b.mod(m);
        d = BIG.mul(a, b);

        return d.mod(m);
    };

    /* return a^2 mod m */
    BIG.modsqr = function(a, m) {
        var d;

        a.mod(m);
        d = BIG.sqr(a);

        return d.mod(m);
    };

    /* return -a mod m */
    BIG.modneg = function(a, m) {
        a.mod(m);
        return m.minus(a);
    };

    /* Arazi and Qi inversion mod 256 */
    BIG.invmod256 = function(a) {
        var U, t1, t2, b, c;

        t1 = 0;
        c = (a >> 1) & 1;
        t1 += c;
        t1 &= 1;
        t1 = 2 - t1;
        t1 <<= 1;
        U = t1 + 1;

        // i=2
        b = a & 3;
        t1 = U * b;
        t1 >>= 2;
        c = (a >> 2) & 3;
        t2 = (U * c) & 3;
        t1 += t2;
        t1 *= U;
        t1 &= 3;
        t1 = 4 - t1;
        t1 <<= 2;
        U += t1;

        // i=4
        b = a & 15;
        t1 = U * b;
        t1 >>= 4;
        c = (a >> 4) & 15;
        t2 = (U * c) & 15;
        t1 += t2;
        t1 *= U;
        t1 &= 15;
        t1 = 16 - t1;
        t1 <<= 4;
        U += t1;

        return U;
    };
    return BIG;
};

/* AMCL double length DBIG number class */
DBIG = function(ctx) {
    "use strict";

    /* constructor */
    var DBIG = function(x) {
        this.w = [];
        this.zero();
        this.w[0] = x;
    };

    DBIG.prototype = {

        /* set this=0 */
        zero: function() {
            for (var i = 0; i < ctx.BIG.DNLEN; i++) {
                this.w[i] = 0;
            }
            return this;
        },

        /* set this=b */
        copy: function(b) {
            for (var i = 0; i < ctx.BIG.DNLEN; i++) {
                this.w[i] = b.w[i];
            }
            return this;
        },


        /* copy from ctx.BIG */
        hcopy: function(b) {
            var i;

            for (i = 0; i < ctx.BIG.NLEN; i++) {
                this.w[i] = b.w[i];
            }

            for (i = ctx.BIG.NLEN; i < ctx.BIG.DNLEN; i++) {
                this.w[i] = 0;
            }

            return this;
        },

        ucopy: function(b) {
            var i;

            for (i = 0; i < ctx.BIG.NLEN; i++) {
                this.w[i] = 0;
            }

            for (i = ctx.BIG.NLEN; i < ctx.BIG.DNLEN; i++) {
                this.w[i] = b.w[i - ctx.BIG.NLEN];
            }

            return this;
        },

        /* normalise this */
        norm: function() {
            var carry = 0,
                d, i;

            for (i = 0; i < ctx.BIG.DNLEN - 1; i++) {
                d = this.w[i] + carry;
                this.w[i] = d & ctx.BIG.BMASK;
                carry = d >> ctx.BIG.BASEBITS;
            }
            this.w[ctx.BIG.DNLEN - 1] = (this.w[ctx.BIG.DNLEN - 1] + carry);

            return this;
        },

        /* set this[i]+=x*y+c, and return high part */
        muladd: function(x, y, c, i) {
            var prod = x * y + c + this.w[i];
            this.w[i] = prod & ctx.BIG.BMASK;
            return ((prod - this.w[i]) * ctx.BIG.MODINV);
        },

        /* shift this right by k bits */
        shr: function(k) {
            var n = k % ctx.BIG.BASEBITS,
                m = Math.floor(k / ctx.BIG.BASEBITS),
                i;

            for (i = 0; i < ctx.BIG.DNLEN - m - 1; i++) {
                this.w[i] = (this.w[m + i] >> n) | ((this.w[m + i + 1] << (ctx.BIG.BASEBITS - n)) & ctx.BIG.BMASK);
            }

            this.w[ctx.BIG.DNLEN - m - 1] = this.w[ctx.BIG.DNLEN - 1] >> n;

            for (i = ctx.BIG.DNLEN - m; i < ctx.BIG.DNLEN; i++) {
                this.w[i] = 0;
            }

            return this;
        },

        /* shift this left by k bits */
        shl: function(k) {
            var n = k % ctx.BIG.BASEBITS,
                m = Math.floor(k / ctx.BIG.BASEBITS),
                i;

            this.w[ctx.BIG.DNLEN - 1] = ((this.w[ctx.BIG.DNLEN - 1 - m] << n)) | (this.w[ctx.BIG.DNLEN - m - 2] >> (ctx.BIG.BASEBITS - n));

            for (i = ctx.BIG.DNLEN - 2; i > m; i--) {
                this.w[i] = ((this.w[i - m] << n) & ctx.BIG.BMASK) | (this.w[i - m - 1] >> (ctx.BIG.BASEBITS - n));
            }

            this.w[m] = (this.w[0] << n) & ctx.BIG.BMASK;

            for (i = 0; i < m; i++) {
                this.w[i] = 0;
            }

            return this;
        },

        /* Conditional move of ctx.BIG depending on d using XOR - no branches */
        cmove: function(b, d) {
            var c = d,
                i;

            c = ~(c - 1);

            for (i = 0; i < ctx.BIG.DNLEN; i++) {
                this.w[i] ^= (this.w[i] ^ b.w[i]) & c;
            }
        },

        /* this+=x */
        add: function(x) {
            for (var i = 0; i < ctx.BIG.DNLEN; i++) {
                this.w[i] += x.w[i];
            }
        },

        /* this-=x */
        sub: function(x) {
            for (var i = 0; i < ctx.BIG.DNLEN; i++) {
                this.w[i] -= x.w[i];
            }
        },

        rsub: function(x) {
            for (var i = 0; i < ctx.BIG.DNLEN; i++) {
                this.w[i] = x.w[i] - this.w[i];
            }
        },

        /* return number of bits in this */
        nbits: function() {
            var k = ctx.BIG.DNLEN - 1,
                bts, c;

            this.norm();

            while (k >= 0 && this.w[k] === 0) {
                k--;
            }

            if (k < 0) {
                return 0;
            }

            bts = ctx.BIG.BASEBITS * k;
            c = this.w[k];

            while (c !== 0) {
                c = Math.floor(c / 2);
                bts++;
            }

            return bts;
        },

        /* convert this to string */
        toString: function() {
            var s = "",
                len = this.nbits(),
                b, i;

            if (len % 4 === 0) {
                len = Math.floor(len / 4);
            } else {
                len = Math.floor(len / 4);
                len++;
            }

            for (i = len - 1; i >= 0; i--) {
                b = new DBIG(0);
                b.copy(this);
                b.shr(i * 4);
                s += (b.w[0] & 15).toString(16);
            }

            return s;
        },

        /* reduces this DBIG mod a ctx.BIG, and returns the ctx.BIG */
        mod: function(c) {
            var k = 0,
                m = new DBIG(0),
                dr = new DBIG(0),
                r = new ctx.BIG(0);

            this.norm();
            m.hcopy(c);
            r.hcopy(this);

            if (DBIG.comp(this, m) < 0) {
                return r;
            }

            do {
                m.shl(1);
                k++;
            } while (DBIG.comp(this, m) >= 0);

            while (k > 0) {
                m.shr(1);

                dr.copy(this);
                dr.sub(m);
                dr.norm();
                this.cmove(dr, (1 - ((dr.w[ctx.BIG.DNLEN - 1] >> (ctx.BIG.CHUNK - 1)) & 1)));

                k--;
            }

            r.hcopy(this);

            return r;
        },

        /* this/=c */
        div: function(c) {
            var d = 0,
                k = 0,
                m = new DBIG(0),
                dr = new DBIG(0),
                r = new ctx.BIG(0),
                a = new ctx.BIG(0),
                e = new ctx.BIG(1);

            m.hcopy(c);
            this.norm();

            while (DBIG.comp(this, m) >= 0) {
                e.fshl(1);
                m.shl(1);
                k++;
            }

            while (k > 0) {
                m.shr(1);
                e.shr(1);

                dr.copy(this);
                dr.sub(m);
                dr.norm();
                d = (1 - ((dr.w[ctx.BIG.DNLEN - 1] >> (ctx.BIG.CHUNK - 1)) & 1));
                this.cmove(dr, d);
                r.copy(a);
                r.add(e);
                r.norm();
                a.cmove(r, d);

                k--;
            }
            return a;
        },

        /* split this DBIG at position n, return higher half, keep lower half */
        split: function(n) {
            var t = new ctx.BIG(0),
                m = n % ctx.BIG.BASEBITS,
                carry = this.w[ctx.BIG.DNLEN - 1] << (ctx.BIG.BASEBITS - m),
                nw, i;

            for (i = ctx.BIG.DNLEN - 2; i >= ctx.BIG.NLEN - 1; i--) {
                nw = (this.w[i] >> m) | carry;
                carry = (this.w[i] << (ctx.BIG.BASEBITS - m)) & ctx.BIG.BMASK;
                t.w[i - ctx.BIG.NLEN + 1] = nw;
            }

            this.w[ctx.BIG.NLEN - 1] &= ((1 << m) - 1);

            return t;
        }

    };

    /* Compare a and b, return 0 if a==b, -1 if a<b, +1 if a>b. Inputs must be normalised */
    DBIG.comp = function(a, b) {
        var i;

        for (i = ctx.BIG.DNLEN - 1; i >= 0; i--) {
            if (a.w[i] == b.w[i]) {
                continue;
            }

            if (a.w[i] > b.w[i]) {
                return 1;
            } else {
                return -1;
            }
        }

        return 0;
    };

    return DBIG;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        BIG: BIG,
        DBIG: DBIG
    };
}
