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

/* AMCL Fp^12 functions */

/* FP12 elements are of the form a+i.b+i^2.c */

var FP12 = function(ctx) {
    "use strict";

    /* general purpose constructor */
    var FP12 = function(d, e, f) {
        if (d instanceof FP12) {
            this.a = new ctx.FP4(d.a);
            this.b = new ctx.FP4(d.b);
            this.c = new ctx.FP4(d.c);
        } else {
            this.a = new ctx.FP4(d);
            this.b = new ctx.FP4(e);
            this.c = new ctx.FP4(f);
        }
    };

    FP12.prototype = {
        /* reduce all components of this mod Modulus */
        reduce: function() {
            this.a.reduce();
            this.b.reduce();
            this.c.reduce();
        },

        /* normalize all components of this mod Modulus */
        norm: function() {
            this.a.norm();
            this.b.norm();
            this.c.norm();
        },

        /* test x==0 ? */
        iszilch: function() {
            this.reduce();
            return (this.a.iszilch() && this.b.iszilch() && this.c.iszilch());
        },

        /* test x==1 ? */
        isunity: function() {
            var one = new ctx.FP4(1);
            return (this.a.equals(one) && this.b.iszilch() && this.c.iszilch());
        },


        /* conditional copy of g to this depending on d */
        cmove: function(g, d) {
            this.a.cmove(g.a, d);
            this.b.cmove(g.b, d);
            this.c.cmove(g.c, d);
        },


        /* Constant time select from pre-computed table */
        select: function(g, b) {
            var invf = new FP12(0),
                m, babs;

            m = b >> 31;
            babs = (b ^ m) - m;
            babs = (babs - 1) / 2;

            this.cmove(g[0], FP12.teq(babs, 0));
            this.cmove(g[1], FP12.teq(babs, 1));
            this.cmove(g[2], FP12.teq(babs, 2));
            this.cmove(g[3], FP12.teq(babs, 3));
            this.cmove(g[4], FP12.teq(babs, 4));
            this.cmove(g[5], FP12.teq(babs, 5));
            this.cmove(g[6], FP12.teq(babs, 6));
            this.cmove(g[7], FP12.teq(babs, 7));

            invf.copy(this);
            invf.conj();
            this.cmove(invf, (m & 1));
        },

        /* extract a from this */
        geta: function() {
            return this.a;
        },

        /* extract b */
        getb: function() {
            return this.b;
        },

        /* extract c */
        getc: function() {
            return this.c;
        },

        /* return 1 if x==y, else 0 */
        equals: function(x) {
            return (this.a.equals(x.a) && this.b.equals(x.b) && this.c.equals(x.c));
        },

        /* copy this=x */
        copy: function(x) {
            this.a.copy(x.a);
            this.b.copy(x.b);
            this.c.copy(x.c);
        },

        /* set this=1 */
        one: function() {
            this.a.one();
            this.b.zero();
            this.c.zero();
        },

        /* this=conj(this) */
        conj: function() {
            this.a.conj();
            this.b.nconj();
            this.c.conj();
        },

        /* set this from 3 FP4s */
        set: function(d, e, f) {
            this.a.copy(d);
            this.b.copy(e);
            this.c.copy(f);
        },

        /* set this from one ctx.FP4 */
        seta: function(d) {
            this.a.copy(d);
            this.b.zero();
            this.c.zero();
        },

        /* Granger-Scott Unitary Squaring */
        usqr: function() {
            var A = new ctx.FP4(this.a),
                B = new ctx.FP4(this.c),
                C = new ctx.FP4(this.b),
                D = new ctx.FP4(0);

            this.a.sqr();
            D.copy(this.a);
            D.add(this.a);
            this.a.add(D);

            A.nconj();

            A.add(A);
            this.a.add(A);
            B.sqr();
            B.times_i();

            D.copy(B);
            D.add(B);
            B.add(D);

            C.sqr();
            D.copy(C);
            D.add(C);
            C.add(D);

            this.b.conj();
            this.b.add(this.b);
            this.c.nconj();

            this.c.add(this.c);
            this.b.add(B);
            this.c.add(C);
            this.reduce();
        },

        /* Chung-Hasan SQR2 method from http://cacr.uwaterloo.ca/techreports/2006/cacr2006-24.pdf */
        sqr: function() {
            var A = new ctx.FP4(this.a),
                B = new ctx.FP4(this.b),
                C = new ctx.FP4(this.c),
                D = new ctx.FP4(this.a);

            A.sqr();
            B.mul(this.c);
            B.add(B);
            C.sqr();
            D.mul(this.b);
            D.add(D);

            this.c.add(this.a);
            this.c.add(this.b);
            this.c.norm();
            this.c.sqr();

            this.a.copy(A);

            A.add(B);
            A.add(C);
            A.add(D);
            A.neg();
            B.times_i();
            C.times_i();

            this.a.add(B);
            this.b.copy(C);
            this.b.add(D);
            this.c.add(A);

            this.norm();
        },

        /* FP12 full multiplication this=this*y */
        mul: function(y) {
            var z0 = new ctx.FP4(this.a),
                z1 = new ctx.FP4(0),
                z2 = new ctx.FP4(this.b),
                z3 = new ctx.FP4(0),
                t0 = new ctx.FP4(this.a),
                t1 = new ctx.FP4(y.a);

            z0.mul(y.a);
            z2.mul(y.b);

            t0.add(this.b);
            t1.add(y.b);

            t0.norm();
            t1.norm();

            z1.copy(t0);
            z1.mul(t1);
            t0.copy(this.b);
            t0.add(this.c);

            t1.copy(y.b);
            t1.add(y.c);

            t0.norm();
            t1.norm();
            z3.copy(t0);
            z3.mul(t1);

            t0.copy(z0);
            t0.neg();
            t1.copy(z2);
            t1.neg();

            z1.add(t0);
            this.b.copy(z1);
            this.b.add(t1);

            z3.add(t1);
            z2.add(t0);

            t0.copy(this.a);
            t0.add(this.c);
            t1.copy(y.a);
            t1.add(y.c);

            t0.norm();
            t1.norm();

            t0.mul(t1);
            z2.add(t0);

            t0.copy(this.c);
            t0.mul(y.c);
            t1.copy(t0);
            t1.neg();

            this.c.copy(z2);
            this.c.add(t1);
            z3.add(t1);
            t0.times_i();
            this.b.add(t0);
            z3.times_i();
            this.a.copy(z0);
            this.a.add(z3);

            this.norm();
        },

        /* Special case this*=y that arises from special form of ATE pairing line function */
        smul: function(y, twist) {
            var z0, z1, z2, z3, t0, t1;

            if (twist == ctx.ECP.D_TYPE) {

                z0 = new ctx.FP4(this.a);
                z2 = new ctx.FP4(this.b);
                z3 = new ctx.FP4(this.b);
                t0 = new ctx.FP4(0);
                t1 = new ctx.FP4(y.a);

                z0.mul(y.a);
                z2.pmul(y.b.real());
                this.b.add(this.a);
                t1.real().add(y.b.real());

                this.b.norm();
                t1.norm();

                this.b.mul(t1);
                z3.add(this.c);
                z3.norm();
                z3.pmul(y.b.real());

                t0.copy(z0);
                t0.neg();
                t1.copy(z2);
                t1.neg();

                this.b.add(t0);

                this.b.add(t1);
                z3.add(t1);
                z2.add(t0);

                t0.copy(this.a);
                t0.add(this.c);
                t0.norm();
                t0.mul(y.a);
                this.c.copy(z2);
                this.c.add(t0);

                z3.times_i();
                this.a.copy(z0);
                this.a.add(z3);
            }

            if (twist == ctx.ECP.M_TYPE) {
                z0=new ctx.FP4(this.a);
                z1=new ctx.FP4(0);
                z2=new ctx.FP4(0);
                z3=new ctx.FP4(0);
                t0=new ctx.FP4(this.a);
                t1=new ctx.FP4(0);

                z0.mul(y.a);
                t0.add(this.b);
                t0.norm();

                z1.copy(t0); z1.mul(y.a);
                t0.copy(this.b); t0.add(this.c);
                t0.norm();

                z3.copy(t0);
                z3.pmul(y.c.getb());
                z3.times_i();

                t0.copy(z0); t0.neg();

                z1.add(t0);
                this.b.copy(z1);
                z2.copy(t0);

                t0.copy(this.a); t0.add(this.c);
                t1.copy(y.a); t1.add(y.c);

                t0.norm();
                t1.norm();

                t0.mul(t1);
                z2.add(t0);

                t0.copy(this.c);

                t0.pmul(y.c.getb());
                t0.times_i();

                t1.copy(t0); t1.neg();

                this.c.copy(z2); this.c.add(t1);
                z3.add(t1);
                t0.times_i();
                this.b.add(t0);
                z3.norm();
                z3.times_i();
                this.a.copy(z0); this.a.add(z3);
            }

            this.norm();
        },

        /* this=1/this */
        inverse: function() {
            var f0 = new ctx.FP4(this.a),
                f1 = new ctx.FP4(this.b),
                f2 = new ctx.FP4(this.a),
                f3 = new ctx.FP4(0);

            f0.sqr();
            f1.mul(this.c);
            f1.times_i();
            f0.sub(f1);
            f0.norm();

            f1.copy(this.c);
            f1.sqr();
            f1.times_i();
            f2.mul(this.b);
            f1.sub(f2);
            f1.norm();

            f2.copy(this.b);
            f2.sqr();
            f3.copy(this.a);
            f3.mul(this.c);
            f2.sub(f3);
            f2.norm();

            f3.copy(this.b);
            f3.mul(f2);
            f3.times_i();
            this.a.mul(f0);
            f3.add(this.a);
            this.c.mul(f1);
            this.c.times_i();

            f3.add(this.c);
            f3.norm();
            f3.inverse();
            this.a.copy(f0);
            this.a.mul(f3);
            this.b.copy(f1);
            this.b.mul(f3);
            this.c.copy(f2);
            this.c.mul(f3);
        },

        /* this=this^p, where p=Modulus, using Frobenius */
        frob: function(f) {
            var f2 = new ctx.FP2(f),
                f3 = new ctx.FP2(f);

            f2.sqr();
            f3.mul(f2);

            this.a.frob(f3);
            this.b.frob(f3);
            this.c.frob(f3);

            this.b.pmul(f);
            this.c.pmul(f2);
        },

        /* trace function */
        trace: function() {
            var t = new ctx.FP4(0);

            t.copy(this.a);
            t.imul(3);
            t.reduce();

            return t;
        },

        /* convert this to hex string */
        toString: function() {
            return ("[" + this.a.toString() + "," + this.b.toString() + "," + this.c.toString() + "]");
        },

        /* convert this to byte array */
        toBytes: function(w) {
            var t = [],
                i;

            this.a.geta().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i] = t[i];
            }
            this.a.geta().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + ctx.BIG.MODBYTES] = t[i];
            }
            this.a.getb().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 2 * ctx.BIG.MODBYTES] = t[i];
            }
            this.a.getb().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 3 * ctx.BIG.MODBYTES] = t[i];
            }

            this.b.geta().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 4 * ctx.BIG.MODBYTES] = t[i];
            }
            this.b.geta().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 5 * ctx.BIG.MODBYTES] = t[i];
            }
            this.b.getb().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 6 * ctx.BIG.MODBYTES] = t[i];
            }
            this.b.getb().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 7 * ctx.BIG.MODBYTES] = t[i];
            }

            this.c.geta().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 8 * ctx.BIG.MODBYTES] = t[i];
            }
            this.c.geta().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 9 * ctx.BIG.MODBYTES] = t[i];
            }
            this.c.getb().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 10 * ctx.BIG.MODBYTES] = t[i];
            }
            this.c.getb().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                w[i + 11 * ctx.BIG.MODBYTES] = t[i];
            }
        },

        /* set this=this^e */
        pow: function(e) {
            var e3, w, nb, i, bt;

            this.norm();
            e.norm();

            e3 = new ctx.BIG(e);
            e3.pmul(3);
            e3.norm();

            w = new FP12(this);
            nb = e3.nbits();

            for (i = nb - 2; i >= 1; i--) {
                w.usqr();
                bt = e3.bit(i) - e.bit(i);

                if (bt == 1) {
                    w.mul(this);
                }
                if (bt == -1) {
                    this.conj();
                    w.mul(this);
                    this.conj();
                }
            }
            w.reduce();

            return w;
        },

        /* constant time powering by small integer of max length bts */
        pinpow: function(e, bts) {
            var R = [],
                i, b;

            R[0] = new FP12(1);
            R[1] = new FP12(this);

            for (i = bts - 1; i >= 0; i--) {
                b = (e >> i) & 1;
                R[1 - b].mul(R[b]);
                R[b].usqr();
            }

            this.copy(R[0]);
        },

        /* Faster compressed powering for unitary elements */
        compow: function(e, r) {
            var fa, fb, f, q, m, a, b, g1, g2, c, cp, cpm1, cpm2;

            fa = new ctx.BIG(0);
            fa.rcopy(ctx.ROM_FIELD.Fra);
            fb = new ctx.BIG(0);
            fb.rcopy(ctx.ROM_FIELD.Frb);
            f = new ctx.FP2(fa, fb);

            q = new ctx.BIG(0);
            q.rcopy(ctx.ROM_FIELD.Modulus);

            m = new ctx.BIG(q);
            m.mod(r);

            a = new ctx.BIG(e);
            a.mod(m);

            b = new ctx.BIG(e);
            b.div(m);

            g1 = new FP12(0);
            g2 = new FP12(0);
            g1.copy(this);

            c = g1.trace();

            if (b.iszilch()) {
                c=c.xtr_pow(e);
                return c;
            }

            g2.copy(g1);
            g2.frob(f);
            cp = g2.trace();
            g1.conj();
            g2.mul(g1);
            cpm1 = g2.trace();
            g2.mul(g1);
            cpm2 = g2.trace();

            c = c.xtr_pow2(cp, cpm1, cpm2, a, b);
            return c;
        }
    };

    /* convert from byte array to FP12 */
    FP12.fromBytes = function(w) {
        var t = [],
            i, a, b, c, d, e, f, g, r;

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i];
        }
        a = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + ctx.BIG.MODBYTES];
        }
        b = ctx.BIG.fromBytes(t);
        c = new ctx.FP2(a, b);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 2 * ctx.BIG.MODBYTES];
        }
        a = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 3 * ctx.BIG.MODBYTES];
        }
        b = ctx.BIG.fromBytes(t);
        d = new ctx.FP2(a, b);

        e = new ctx.FP4(c, d);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 4 * ctx.BIG.MODBYTES];
        }
        a = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 5 * ctx.BIG.MODBYTES];
        }
        b = ctx.BIG.fromBytes(t);
        c = new ctx.FP2(a, b);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 6 * ctx.BIG.MODBYTES];
        }
        a = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 7 * ctx.BIG.MODBYTES];
        }
        b = ctx.BIG.fromBytes(t);
        d = new ctx.FP2(a, b);

        f = new ctx.FP4(c, d);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 8 * ctx.BIG.MODBYTES];
        }
        a = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 9 * ctx.BIG.MODBYTES];
        }
        b = ctx.BIG.fromBytes(t);
        c = new ctx.FP2(a, b);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 10 * ctx.BIG.MODBYTES];
        }
        a = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = w[i + 11 * ctx.BIG.MODBYTES];
        }
        b = ctx.BIG.fromBytes(t);
        d = new ctx.FP2(a, b);

        g = new ctx.FP4(c, d);

        r = new FP12(e, f, g);

        return r;
    };


    /* return 1 if b==c, no branching */
    FP12.teq = function(b, c) {
        var x = b ^ c;
        x -= 1; // if x=0, x now -1
        return ((x >> 31) & 1);
    };

    /* p=q0^u0.q1^u1.q2^u2.q3^u3 */
    // Bos & Costello https://eprint.iacr.org/2013/458.pdf
    // Faz-Hernandez & Longa & Sanchez  https://eprint.iacr.org/2013/158.pdf
    // Side channel attack secure
    FP12.pow4 = function(q, u) {
        var g = [],
            r = new FP12(0),
            p = new FP12(0),
            t = [],
            mt = new ctx.BIG(0),
            w = [],
            s = [],
            i, j, k, nb, bt, pb;

        for (i = 0; i < 4; i++) {
            t[i] = new ctx.BIG(u[i]); t[i].norm();
        }

        g[0] = new FP12(q[0]);
        g[1] = new FP12(g[0]); g[1].mul(q[1]);
        g[2] = new FP12(g[0]); g[2].mul(q[2]);
        g[3] = new FP12(g[1]); g[3].mul(q[2]);
        g[4] = new FP12(q[0]); g[4].mul(q[3]);
        g[5] = new FP12(g[1]); g[5].mul(q[3]);
        g[6] = new FP12(g[2]); g[6].mul(q[3]);
        g[7] = new FP12(g[3]); g[7].mul(q[3]);

        // Make it odd
        pb=1-t[0].parity();
        t[0].inc(pb);
        t[0].norm();

        // Number of bits
        mt.zero();
        for (i=0;i<4;i++) {
            mt.or(t[i]);
        }

        nb=1+mt.nbits();

        // Sign pivot
        s[nb-1]=1;
        for (i=0;i<nb-1;i++) {
            t[0].fshr(1);
            s[i]=2*t[0].parity()-1;
        }

        // Recoded exponent
        for (i=0; i<nb; i++) {
            w[i]=0;
            k=1;
            for (j=1; j<4; j++) {
                bt=s[i]*t[j].parity();
                t[j].fshr(1);
                t[j].dec(bt>>1);
                t[j].norm();
                w[i]+=bt*k;
                k*=2;
            }
        }

        // Main loop
        p.select(g,2*w[nb-1]+1);
        for (i=nb-2;i>=0;i--) {
            p.usqr();
            r.select(g,2*w[i]+s[i]);
            p.mul(r);
        }

        // apply correction
        r.copy(q[0]); r.conj();
        r.mul(p);
        p.cmove(r,pb);

        p.reduce();
        return p;
    };

    return FP12;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        FP12: FP12
    };
}
