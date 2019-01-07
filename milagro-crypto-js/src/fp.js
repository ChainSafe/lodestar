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

/* Finite Field arithmetic */
/* AMCL mod p functions */

var FP = function(ctx) {
    "use strict";

    /* General purpose Constructor */
    var FP = function(x) {
        if (x instanceof FP) {
            this.f = new ctx.BIG(x.f);
            this.XES = x.XES;
        } else {
            this.f = new ctx.BIG(x);
            this.nres();
        }
    };

    FP.NOT_SPECIAL = 0;
    FP.PSEUDO_MERSENNE = 1;
    FP.GENERALISED_MERSENNE = 2;
    FP.MONTGOMERY_FRIENDLY = 3;

    FP.MODBITS = ctx.config["@NBT"];
    FP.MOD8 = ctx.config["@M8"];
    FP.MODTYPE = ctx.config["@MT"];

    FP.FEXCESS = (1 << ctx.config["@SH"]); // 2^(BASEBITS*NLEN-MODBITS)
    FP.OMASK = (-1) << FP.TBITS;
    FP.TBITS = FP.MODBITS % ctx.BIG.BASEBITS;
    FP.TMASK = (1 << FP.TBITS) - 1;

    FP.prototype = {
        /* set this=0 */
        zero: function() {
            this.XES = 1;
            this.f.zero();
        },

        /* copy from a ctx.BIG in ROM */
        rcopy: function(y) {
            this.f.rcopy(y);
            this.nres();
        },

        /* copy from another ctx.BIG */
        bcopy: function(y) {
            this.f.copy(y);
            this.nres();
        },

        /* copy from another FP */
        copy: function(y) {
            this.XES = y.XES;
            this.f.copy(y.f);
        },

        /* conditional swap of a and b depending on d */
        cswap: function(b, d) {
            this.f.cswap(b.f, d);
            var t, c = d;
            c = ~(c - 1);
            t = c & (this.XES ^ b.XES);
            this.XES ^= t;
            b.XES ^= t;
        },

        /* conditional copy of b to a depending on d */
        cmove: function(b, d) {
            var c = d;

            c = ~(c - 1);

            this.f.cmove(b.f, d);
            this.XES ^= (this.XES ^ b.XES) & c;
        },

        /* convert to Montgomery n-residue form */
        nres: function() {
            var r, d;

            if (FP.MODTYPE != FP.PSEUDO_MERSENNE && FP.MODTYPE != FP.GENERALISED_MERSENNE) {
                r = new ctx.BIG();
                r.rcopy(ctx.ROM_FIELD.R2modp);

                d = ctx.BIG.mul(this.f, r);
                this.f.copy(FP.mod(d));
                this.XES = 2;
            } else {
                this.XES = 1;
            }

            return this;
        },

        /* convert back to regular form */
        redc: function() {
            var r = new ctx.BIG(0),
                d, w;

            r.copy(this.f);

            if (FP.MODTYPE != FP.PSEUDO_MERSENNE && FP.MODTYPE != FP.GENERALISED_MERSENNE) {
                d = new ctx.DBIG(0);
                d.hcopy(this.f);
                w = FP.mod(d);
                r.copy(w);
            }

            return r;
        },

        /* convert this to string */
        toString: function() {
            var s = this.redc().toString();
            return s;
        },

        /* test this=0 */
        iszilch: function() {
            this.reduce();
            return this.f.iszilch();
        },

        /* reduce this mod Modulus */
        reduce: function() {
            var p = new ctx.BIG(0);
            p.rcopy(ctx.ROM_FIELD.Modulus);
            this.f.mod(p);
            this.XES = 1;
        },

        /* set this=1 */
        one: function() {
            this.f.one();
            return this.nres();
        },

        /* normalise this */
        norm: function() {
            return this.f.norm();
        },

        /* this*=b mod Modulus */
        mul: function(b) {
            var d;

            if (this.XES * b.XES > FP.FEXCESS) {
                this.reduce();
            }

            d = ctx.BIG.mul(this.f, b.f);
            this.f.copy(FP.mod(d));
            this.XES = 2;

            return this;
        },

        /* this*=c mod Modulus where c is an int */
        imul: function(c) {
            var s = false,
                d, n;

            if (c < 0) {
                c = -c;
                s = true;
            }

            if (FP.MODTYPE == FP.PSEUDO_MERSENNE || FP.MODTYPE == FP.GENERALISED_MERSENNE) {
                d = this.f.pxmul(c);
                this.f.copy(FP.mod(d));
                this.XES = 2;
            } else {
                if (this.XES * c <= FP.FEXCESS) {
                    this.f.pmul(c);
                    this.XES *= c;
                } else {
                    n = new FP(c);
                    this.mul(n);
                }
            }

            if (s) {
                this.neg();
                this.norm();
            }
            return this;
        },

        /* this*=this mod Modulus */
        sqr: function() {
            var d, t;

            if (this.XES * this.XES > FP.FEXCESS) {
                this.reduce();
            }

            d = ctx.BIG.sqr(this.f);
            t = FP.mod(d);
            this.f.copy(t);
            this.XES = 2;

            return this;
        },

        /* this+=b */
        add: function(b) {
            this.f.add(b.f);
            this.XES += b.XES;

            if (this.XES > FP.FEXCESS) {
                this.reduce();
            }

            return this;
        },
        /* this=-this mod Modulus */
        neg: function() {
            var m = new ctx.BIG(0),
                sb;

            m.rcopy(ctx.ROM_FIELD.Modulus);

            sb = FP.logb2(this.XES - 1);

            m.fshl(sb);
            this.XES = (1 << sb);
            this.f.rsub(m);

            if (this.XES > FP.FEXCESS) {
                this.reduce();
            }

            return this;
        },

        /* this-=b */
        sub: function(b) {
            var n = new FP(0);

            n.copy(b);
            n.neg();
            this.add(n);

            return this;
        },

        rsub: function(b) {
            var n = new FP(0);

            n.copy(this);
            n.neg();
            this.copy(b);
            this.add(n);
        },

        /* this/=2 mod Modulus */
        div2: function() {
            var p;

            if (this.f.parity() === 0) {
                this.f.fshr(1);
            } else {
                p = new ctx.BIG(0);
                p.rcopy(ctx.ROM_FIELD.Modulus);

                this.f.add(p);
                this.f.norm();
                this.f.fshr(1);
            }

            return this;
        },

        /* this=1/this mod Modulus */
        inverse: function() {
            var m2=new ctx.BIG(0);

            m2.rcopy(ctx.ROM_FIELD.Modulus);
            m2.dec(2); m2.norm();
            this.copy(this.pow(m2));
            return this;

        },

        /* return TRUE if this==a */
        equals: function(a) {
            a.reduce();
            this.reduce();

            if (ctx.BIG.comp(a.f, this.f) === 0) {
                return true;
            }

            return false;
        },

        /* return this^e mod Modulus */
        pow: function(e) {
            var i,w=[],
                tb=[],
                t=new ctx.BIG(e),
                nb, lsbs, r;

            t.norm();
            nb= 1 + Math.floor((t.nbits() + 3) / 4);

            for (i=0;i<nb;i++) {
                lsbs=t.lastbits(4);
                t.dec(lsbs);
                t.norm();
                w[i]=lsbs;
                t.fshr(4);
            }
            tb[0]=new FP(1);
            tb[1]=new FP(this);
            for (i=2;i<16;i++) {
                tb[i]=new FP(tb[i-1]);
                tb[i].mul(this);
            }
            r=new FP(tb[w[nb-1]]);
            for (i=nb-2;i>=0;i--) {
                r.sqr();
                r.sqr();
                r.sqr();
                r.sqr();
                r.mul(tb[w[i]]);
            }
            r.reduce();
            return r;
        },

        /* return jacobi symbol (this/Modulus) */
        jacobi: function() {
            var p = new ctx.BIG(0),
                w = this.redc();

            p.rcopy(ctx.ROM_FIELD.Modulus);

            return w.jacobi(p);
        },

        /* return sqrt(this) mod Modulus */
        sqrt: function() {
            var b = new ctx.BIG(0),
                i, v, r;

            this.reduce();

            b.rcopy(ctx.ROM_FIELD.Modulus);

            if (FP.MOD8 == 5) {
                b.dec(5);
                b.norm();
                b.shr(3);
                i = new FP(0);
                i.copy(this);
                i.f.shl(1);
                v = i.pow(b);
                i.mul(v);
                i.mul(v);
                i.f.dec(1);
                r = new FP(0);
                r.copy(this);
                r.mul(v);
                r.mul(i);
                r.reduce();

                return r;
            } else {
                b.inc(1);
                b.norm();
                b.shr(2);

                return this.pow(b);
            }
        }

    };

    FP.logb2 = function(v) {
        var r;

        v |= v >>> 1;
        v |= v >>> 2;
        v |= v >>> 4;
        v |= v >>> 8;
        v |= v >>> 16;

        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        r = ((v + (v >>> 4) & 0xF0F0F0F) * 0x1010101) >>> 24;

        return r;
    };

    /* reduce a ctx.DBIG to a ctx.BIG using a "special" modulus */
    FP.mod = function(d) {
        var b = new ctx.BIG(0),
            i, t, v, tw, tt, lo, carry, m, dd;

        if (FP.MODTYPE == FP.PSEUDO_MERSENNE) {
            t = d.split(FP.MODBITS);
            b.hcopy(d);

            if (ctx.ROM_FIELD.MConst != 1) {
                v = t.pmul(ctx.ROM_FIELD.MConst);
            } else {
                v = 0;
            }

            t.add(b);
            t.norm();

            tw = t.w[ctx.BIG.NLEN - 1];
            t.w[ctx.BIG.NLEN - 1] &= FP.TMASK;
            t.inc(ctx.ROM_FIELD.MConst * ((tw >> FP.TBITS) + (v << (ctx.BIG.BASEBITS - FP.TBITS))));
            t.norm();

            return t;
        }

        if (FP.MODTYPE == FP.MONTGOMERY_FRIENDLY) {
            for (i = 0; i < ctx.BIG.NLEN; i++) {
                d.w[ctx.BIG.NLEN + i] += d.muladd(d.w[i], ctx.ROM_FIELD.MConst - 1, d.w[i], ctx.BIG.NLEN + i - 1);
            }

            for (i = 0; i < ctx.BIG.NLEN; i++) {
                b.w[i] = d.w[ctx.BIG.NLEN + i];
            }

            b.norm();
        }

        // GoldiLocks Only
        if (FP.MODTYPE == FP.GENERALISED_MERSENNE) {
            t = d.split(FP.MODBITS);
            b.hcopy(d);
            b.add(t);
            dd = new ctx.DBIG(0);
            dd.hcopy(t);
            dd.shl(FP.MODBITS / 2);

            tt = dd.split(FP.MODBITS);
            lo = new ctx.BIG();
            lo.hcopy(dd);

            b.add(tt);
            b.add(lo);
            tt.shl(FP.MODBITS / 2);
            b.add(tt);

            carry = b.w[ctx.BIG.NLEN - 1] >> FP.TBITS;
            b.w[ctx.BIG.NLEN - 1] &= FP.TMASK;
            b.w[0] += carry;

            b.w[Math.floor(224 / ctx.BIG.BASEBITS)] += carry << (224 % ctx.BIG.BASEBITS);
            b.norm();
        }

        if (FP.MODTYPE == FP.NOT_SPECIAL) {
            m = new ctx.BIG(0);
            m.rcopy(ctx.ROM_FIELD.Modulus);

            b.copy(ctx.BIG.monty(m, ctx.ROM_FIELD.MConst, d));
        }

        return b;
    };

    return FP;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        FP: FP
    };
}
