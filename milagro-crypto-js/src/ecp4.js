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

/* AMCL Weierstrass elliptic curve functions over ctx.FP4 */

var ECP4 = function(ctx) {
    "use strict";

    /* Constructor, set this=O */
    var ECP4 = function() {
        this.x = new ctx.FP4(0);
        this.y = new ctx.FP4(1);
        this.z = new ctx.FP4(0);
    };

    ECP4.prototype = {
        /* Test this=O? */
        is_infinity: function() {
            this.x.reduce();
            this.y.reduce();
            this.z.reduce();
            return (this.x.iszilch() && this.z.iszilch());
        },

        /* copy this=P */
        copy: function(P) {
            this.x.copy(P.x);
            this.y.copy(P.y);
            this.z.copy(P.z);
        },

        /* set this=O */
        inf: function() {
            this.x.zero();
            this.y.one();
            this.z.zero();
        },

        /* conditional move of Q to P dependant on d */
        cmove: function(Q, d) {
            this.x.cmove(Q.x, d);
            this.y.cmove(Q.y, d);
            this.z.cmove(Q.z, d);
        },

        /* Constant time select from pre-computed table */
        select: function(W, b) {
            var MP = new ECP4(),
                m = b >> 31,
                babs = (b ^ m) - m;

            babs = (babs - 1) / 2;

            this.cmove(W[0], ECP4.teq(babs, 0)); // conditional move
            this.cmove(W[1], ECP4.teq(babs, 1));
            this.cmove(W[2], ECP4.teq(babs, 2));
            this.cmove(W[3], ECP4.teq(babs, 3));
            this.cmove(W[4], ECP4.teq(babs, 4));
            this.cmove(W[5], ECP4.teq(babs, 5));
            this.cmove(W[6], ECP4.teq(babs, 6));
            this.cmove(W[7], ECP4.teq(babs, 7));

            MP.copy(this);
            MP.neg();
            this.cmove(MP, (m & 1));
        },

        /* Test P == Q */
        equals: function(Q) {
            var a, b;

            a = new ctx.FP4(this.x);
            b = new ctx.FP4(Q.x);

            a.mul(Q.z);
            b.mul(this.z);
            if (!a.equals(b)) {
                return false;
            }

            a.copy(this.y);
            a.mul(Q.z);
            b.copy(Q.y);
            b.mul(this.z);
            if (!a.equals(b)) {
                return false;
            }

            return true;
        },

        /* set this=-this */
        neg: function() {
            this.y.norm();
            this.y.neg();
            this.y.norm();
            return;
        },

        /* convert this to affine, from (x,y,z) to (x,y) */
        affine: function() {
            var one;

            if (this.is_infinity()) {
                return;
            }

            one = new ctx.FP4(1);

            if (this.z.equals(one)) {
                this.x.reduce();
                this.y.reduce();
                return;
            }

            this.z.inverse();

            this.x.mul(this.z);
            this.x.reduce();
            this.y.mul(this.z);
            this.y.reduce();
            this.z.copy(one);
        },

        /* extract affine x as ctx.FP4 */
        getX: function() {
            this.affine();
            return this.x;
        },

        /* extract affine y as ctx.FP4 */
        getY: function() {
            this.affine();
            return this.y;
        },

        /* extract projective x */
        getx: function() {
            return this.x;
        },

        /* extract projective y */
        gety: function() {
            return this.y;
        },

        /* extract projective z */
        getz: function() {
            return this.z;
        },

        /* convert this to byte array */
        toBytes: function(b) {
            var t = [],
                i;

            this.affine();
            this.x.geta().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i] = t[i];
            }
            this.x.geta().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i + ctx.BIG.MODBYTES] = t[i];
            }
            this.x.getb().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i + 2*ctx.BIG.MODBYTES] = t[i];
            }
            this.x.getb().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i + 3*ctx.BIG.MODBYTES] = t[i];
            }


            this.y.geta().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i + 4 * ctx.BIG.MODBYTES] = t[i];
            }
            this.y.geta().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i + 5 * ctx.BIG.MODBYTES] = t[i];
            }
            this.y.getb().getA().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i + 6 * ctx.BIG.MODBYTES] = t[i];
            }
            this.y.getb().getB().toBytes(t);
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i + 7 * ctx.BIG.MODBYTES] = t[i];
            }
        },

        /* convert this to hex string */
        toString: function() {
            if (this.is_infinity()) {
                return "infinity";
            }
            this.affine();
            return "(" + this.x.toString() + "," + this.y.toString() + ")";
        },

        /* set this=(x,y) */
        setxy: function(ix, iy) {
            var rhs, y2;

            this.x.copy(ix);
            this.y.copy(iy);
            this.z.one();

            rhs = ECP4.RHS(this.x);

            y2 = new ctx.FP4(this.y);
            y2.sqr();

            if (!y2.equals(rhs)) {
                this.inf();
            }
        },

        /* set this=(x,.) */
        setx: function(ix) {
            var rhs;

            this.x.copy(ix);
            this.z.one();

            rhs = ECP4.RHS(this.x);

            if (rhs.sqrt()) {
                this.y.copy(rhs);
            } else {
                this.inf();
            }
        },

        /* set this*=q, where q is Modulus, using Frobenius */
        frob: function(F,n) {
            for (var i=0;i<n;i++) {
                this.x.frob(F[2]);
                this.x.pmul(F[0]);

                this.y.frob(F[2]);
                this.y.pmul(F[1]);
                this.y.times_i();

                this.z.frob(F[2]);
            }
        },

        /* this+=this */
        dbl: function() {
            var iy, t0, t1, t2, x3, y3;

            iy = new ctx.FP4(this.y);
            if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
                iy.times_i();
                iy.norm();
            }

            t0 = new ctx.FP4(this.y);
            t0.sqr();
            if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
                t0.times_i();
            }
            t1 = new ctx.FP4(iy);
            t1.mul(this.z);
            t2 = new ctx.FP4(this.z);
            t2.sqr();

            this.z.copy(t0);
            this.z.add(t0);
            this.z.norm();
            this.z.add(this.z);
            this.z.add(this.z);
            this.z.norm();

            t2.imul(3 * ctx.ROM_CURVE.CURVE_B_I);
            if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
                t2.times_i();
            }

            x3 = new ctx.FP4(t2);
            x3.mul(this.z);

            y3 = new ctx.FP4(t0);

            y3.add(t2);
            y3.norm();
            this.z.mul(t1);
            t1.copy(t2);
            t1.add(t2);
            t2.add(t1);
            t2.norm();
            t0.sub(t2);
            t0.norm(); //y^2-9bz^2
            y3.mul(t0);
            y3.add(x3); //(y^2+3z*2)(y^2-9z^2)+3b.z^2.8y^2
            t1.copy(this.x);
            t1.mul(iy);
            this.x.copy(t0);
            this.x.norm();
            this.x.mul(t1);
            this.x.add(this.x); //(y^2-9bz^2)xy2

            this.x.norm();
            this.y.copy(y3);
            this.y.norm();

            return 1;
        },

        /* this+=Q */
        add: function(Q) {
            var b, t0, t1, t2, t3, t4, x3, y3, z3;

            b = 3 * ctx.ROM_CURVE.CURVE_B_I;
            t0 = new ctx.FP4(this.x);
            t0.mul(Q.x); // x.Q.x
            t1 = new ctx.FP4(this.y);
            t1.mul(Q.y); // y.Q.y

            t2 = new ctx.FP4(this.z);
            t2.mul(Q.z);
            t3 = new ctx.FP4(this.x);
            t3.add(this.y);
            t3.norm(); //t3=X1+Y1
            t4 = new ctx.FP4(Q.x);
            t4.add(Q.y);
            t4.norm(); //t4=X2+Y2
            t3.mul(t4); //t3=(X1+Y1)(X2+Y2)
            t4.copy(t0);
            t4.add(t1); //t4=X1.X2+Y1.Y2

            t3.sub(t4);
            t3.norm();
            if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
                t3.times_i();  //t3=(X1+Y1)(X2+Y2)-(X1.X2+Y1.Y2) = X1.Y2+X2.Y1
            }

            t4.copy(this.y);
            t4.add(this.z);
            t4.norm(); //t4=Y1+Z1
            x3 = new ctx.FP4(Q.y);
            x3.add(Q.z);
            x3.norm(); //x3=Y2+Z2

            t4.mul(x3); //t4=(Y1+Z1)(Y2+Z2)
            x3.copy(t1);
            x3.add(t2); //X3=Y1.Y2+Z1.Z2

            t4.sub(x3);
            t4.norm();
            if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
                t4.times_i();  //t4=(Y1+Z1)(Y2+Z2) - (Y1.Y2+Z1.Z2) = Y1.Z2+Y2.Z1
            }

            x3.copy(this.x);
            x3.add(this.z);
            x3.norm(); // x3=X1+Z1
            y3 = new ctx.FP4(Q.x);
            y3.add(Q.z);
            y3.norm(); // y3=X2+Z2
            x3.mul(y3); // x3=(X1+Z1)(X2+Z2)
            y3.copy(t0);
            y3.add(t2); // y3=X1.X2+Z1+Z2
            y3.rsub(x3);
            y3.norm(); // y3=(X1+Z1)(X2+Z2) - (X1.X2+Z1.Z2) = X1.Z2+X2.Z1

            if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
                t0.times_i();
                t1.times_i();
            }

            x3.copy(t0);
            x3.add(t0);
            t0.add(x3);
            t0.norm();
            t2.imul(b);
            if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
                t2.times_i();
            }

            z3 = new ctx.FP4(t1);
            z3.add(t2);
            z3.norm();
            t1.sub(t2);
            t1.norm();
            y3.imul(b);
            if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
                y3.times_i();
            }

            x3.copy(y3);
            x3.mul(t4);
            t2.copy(t3);
            t2.mul(t1);
            x3.rsub(t2);
            y3.mul(t0);
            t1.mul(z3);
            y3.add(t1);
            t0.mul(t3);
            z3.mul(t4);
            z3.add(t0);

            this.x.copy(x3);
            this.x.norm();
            this.y.copy(y3);
            this.y.norm();
            this.z.copy(z3);
            this.z.norm();

            return 0;
        },

        /* this-=Q */
        sub: function(Q) {
            var D;

            Q.neg();
            D = this.add(Q);
            Q.neg();

            return D;
        },

        /* P*=e */
        mul: function(e) {
            /* fixed size windows */
            var mt = new ctx.BIG(),
                t = new ctx.BIG(),
                C = new ECP4(),
                P = new ECP4(),
                Q = new ECP4(),
                W = [],
                w = [],
                i, nb, s, ns;

            if (this.is_infinity()) {
                return new ECP4();
            }

            this.affine();

            // precompute table
            Q.copy(this);
            Q.dbl();
            W[0] = new ECP4();
            W[0].copy(this);

            for (i = 1; i < 8; i++) {
                W[i] = new ECP4();
                W[i].copy(W[i - 1]);
                W[i].add(Q);
            }

            // make exponent odd - add 2P if even, P if odd
            t.copy(e);
            s = t.parity();
            t.inc(1);
            t.norm();
            ns = t.parity();
            mt.copy(t);
            mt.inc(1);
            mt.norm();
            t.cmove(mt, s);
            Q.cmove(this, ns);
            C.copy(Q);

            nb = 1 + Math.floor((t.nbits() + 3) / 4);

            // convert exponent to signed 4-bit window
            for (i = 0; i < nb; i++) {
                w[i] = (t.lastbits(5) - 16);
                t.dec(w[i]);
                t.norm();
                t.fshr(4);
            }
            w[nb] = t.lastbits(5);

            P.copy(W[Math.floor((w[nb] - 1) / 2)]);
            for (i = nb - 1; i >= 0; i--) {
                Q.select(W, w[i]);
                P.dbl();
                P.dbl();
                P.dbl();
                P.dbl();
                P.add(Q);
            }
            P.sub(C);
            P.affine();

            return P;
        }
    };

    // set to group generator
    ECP4.generator = function() {
        var G=new ECP4(),
            A = new ctx.BIG(0),
            B = new ctx.BIG(0),
            XA, XB, X, YA, YB, Y;

        A.rcopy(ctx.ROM_CURVE.CURVE_Pxaa);
        B.rcopy(ctx.ROM_CURVE.CURVE_Pxab);
        XA= new ctx.FP2(A,B);

        A.rcopy(ctx.ROM_CURVE.CURVE_Pxba);
        B.rcopy(ctx.ROM_CURVE.CURVE_Pxbb);

        XB= new ctx.FP2(A,B);
        X=new ctx.FP4(XA,XB);

        A.rcopy(ctx.ROM_CURVE.CURVE_Pyaa);
        B.rcopy(ctx.ROM_CURVE.CURVE_Pyab);
        YA= new ctx.FP2(A,B);

        A.rcopy(ctx.ROM_CURVE.CURVE_Pyba);
        B.rcopy(ctx.ROM_CURVE.CURVE_Pybb);

        YB= new ctx.FP2(A,B);
        Y=new ctx.FP4(YA,YB);

        G.setxy(X,Y);

        return G;
    };

    /* convert from byte array to point */
    ECP4.fromBytes = function(b) {
        var t = [],
            ra, rb, ra4, rb4, i, rx, ry, P;

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i];
        }
        ra = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i + ctx.BIG.MODBYTES];
        }
        rb = ctx.BIG.fromBytes(t);
        ra4=new ctx.FP2(ra,rb);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i  + 2*ctx.BIG.MODBYTES];
        }
        ra = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i + 3*ctx.BIG.MODBYTES];
        }
        rb = ctx.BIG.fromBytes(t);
        rb4=new ctx.FP2(ra,rb);

        rx = new ctx.FP4(ra4, rb4);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i + 4 * ctx.BIG.MODBYTES];
        }
        ra = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i + 5 * ctx.BIG.MODBYTES];
        }
        rb = ctx.BIG.fromBytes(t);
        ra4=new ctx.FP2(ra,rb);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i + 6 * ctx.BIG.MODBYTES];
        }
        ra = ctx.BIG.fromBytes(t);
        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i + 7 * ctx.BIG.MODBYTES];
        }
        rb = ctx.BIG.fromBytes(t);
        rb4=new ctx.FP2(ra,rb);


        ry = new ctx.FP4(ra4, rb4);

        P = new ECP4();
        P.setxy(rx, ry);

        return P;
    };

    /* Calculate RHS of curve equation x^3+B */
    ECP4.RHS = function(x) {
        var r, c, b;

        x.norm();
        r = new ctx.FP4(x);
        r.sqr();

        c = new ctx.BIG(0);
        c.rcopy(ctx.ROM_CURVE.CURVE_B);
        b = new ctx.FP4(c);

        if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
            b.div_i();
        }
        if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
            b.times_i();
        }

        r.mul(x);
        r.add(b);

        r.reduce();
        return r;
    };

    /* P=u0.Q0+u1*Q1+u2*Q2+u3*Q3... */
    // Bos & Costello https://eprint.iacr.org/2013/458.pdf
    // Faz-Hernandez & Longa & Sanchez  https://eprint.iacr.org/2013/158.pdf
    // Side channel attack secure
    ECP4.mul8 = function(Q, u) {
        var W = new ECP4(),
            P = new ECP4(),
            T1 = [],
            T2 = [],
            mt = new ctx.BIG(),
            t = [],
            w1 = [],
            s1 = [],
            w2 = [],
            s2 = [],
            F=ECP4.frob_constants(),
            i, j, k, nb, bt, pb1, pb2;

        for (i = 0; i < 8; i++) {
            t[i] = new ctx.BIG(u[i]); t[i].norm();
            Q[i].affine();
        }

        T1[0] = new ECP4(); T1[0].copy(Q[0]);
        T1[1] = new ECP4(); T1[1].copy(T1[0]); T1[1].add(Q[1]);
        T1[2] = new ECP4(); T1[2].copy(T1[0]); T1[2].add(Q[2]);
        T1[3] = new ECP4(); T1[3].copy(T1[1]); T1[3].add(Q[2]);
        T1[4] = new ECP4(); T1[4].copy(T1[0]); T1[4].add(Q[3]);
        T1[5] = new ECP4(); T1[5].copy(T1[1]); T1[5].add(Q[3]);
        T1[6] = new ECP4(); T1[6].copy(T1[2]); T1[6].add(Q[3]);
        T1[7] = new ECP4(); T1[7].copy(T1[3]); T1[7].add(Q[3]);

        //  Use Frobenius
        for (i=0;i<8;i++) {
            T2[i] = new ECP4(); T2[i].copy(T1[i]);
            T2[i].frob(F,4);
        }

        // Make it odd
        pb1=1-t[0].parity();
        t[0].inc(pb1);
        t[0].norm();

        pb2=1-t[4].parity();
        t[4].inc(pb2);
        t[4].norm();

        // Number of bits
        mt.zero();
        for (i=0;i<8;i++) {
            mt.or(t[i]);
        }

        nb=1+mt.nbits();

        // Sign pivot
        s1[nb-1]=1;
        s2[nb-1]=1;
        for (i=0;i<nb-1;i++) {
            t[0].fshr(1);
            s1[i]=2*t[0].parity()-1;
            t[4].fshr(1);
            s2[i]=2*t[4].parity()-1;
        }

        // Recoded exponent
        for (i=0; i<nb; i++) {
            w1[i]=0;
            k=1;
            for (j=1; j<4; j++) {
                bt=s1[i]*t[j].parity();
                t[j].fshr(1);
                t[j].dec(bt>>1);
                t[j].norm();
                w1[i]+=bt*k;
                k*=2;
            }
            w2[i]=0;
            k=1;
            for (j=5; j<8; j++) {
                bt=s2[i]*t[j].parity();
                t[j].fshr(1);
                t[j].dec(bt>>1);
                t[j].norm();
                w2[i]+=bt*k;
                k*=2;
            }
        }

        // Main loop
        P.select(T1,2*w1[nb-1]+1);
        W.select(T2,2*w2[nb-1]+1);
        P.add(W);
        for (i=nb-2;i>=0;i--) {
            P.dbl();
            W.select(T1,2*w1[i]+s1[i]);
            P.add(W);
            W.select(T2,2*w2[i]+s2[i]);
            P.add(W);
        }

        // apply correction
        W.copy(P);
        W.sub(Q[0]);
        P.cmove(W,pb1);

        W.copy(P);
        W.sub(Q[4]);
        P.cmove(W,pb2);

        P.affine();
        return P;
    };

    /* return 1 if b==c, no branching */
    ECP4.teq = function(b, c) {
        var x = b ^ c;
        x -= 1; // if x=0, x now -1
        return ((x >> 31) & 1);
    };

    /* needed for SOK */
    ECP4.mapit = function(h) {
        var F=ECP4.frob_constants(),
            q, x, one, Q, X, X2, xQ, x2Q, x3Q, x4Q;

        q = new ctx.BIG(0);
        q.rcopy(ctx.ROM_FIELD.Modulus);
        x = ctx.BIG.fromBytes(h);
        one = new ctx.BIG(1);
        x.mod(q);

        for (;;) {
            X2 = new ctx.FP2(one, x);
            X = new ctx.FP4(X2);
            Q = new ECP4();
            Q.setx(X);
            if (!Q.is_infinity()) {
                break;
            }
            x.inc(1);
            x.norm();
        }

        /* Fast Hashing to G2 - Fuentes-Castaneda, Knapp and Rodriguez-Henriquez */
        x = new ctx.BIG(0);
        x.rcopy(ctx.ROM_CURVE.CURVE_Bnx);


        xQ = Q.mul(x);
        x2Q = xQ.mul(x);
        x3Q = x2Q.mul(x);
        x4Q = x3Q.mul(x);

        if (ctx.ECP.SIGN_OF_X == ctx.ECP.NEGATIVEX) {
            xQ.neg();
            x3Q.neg();
        }

        x4Q.sub(x3Q);
        x4Q.sub(Q);

        x3Q.sub(x2Q);
        x3Q.frob(F,1);

        x2Q.sub(xQ);
        x2Q.frob(F,2);

        xQ.sub(Q);
        xQ.frob(F,3);

        Q.dbl();
        Q.frob(F,4);

        Q.add(x4Q);
        Q.add(x3Q);
        Q.add(x2Q);
        Q.add(xQ);

        Q.affine();
        return Q;
    };

    ECP4.frob_constants = function() {
        var fa = new ctx.BIG(0),
            fb = new ctx.BIG(0),
            F=[],
            X, F0, F1, F2;

        fa.rcopy(ctx.ROM_FIELD.Fra);
        fb.rcopy(ctx.ROM_FIELD.Frb);
        X = new ctx.FP2(fa, fb);

        F0=new ctx.FP2(X); F0.sqr();
        F2=new ctx.FP2(F0);
        F2.mul_ip(); F2.norm();
        F1=new ctx.FP2(F2); F1.sqr();
        F2.mul(F1);
        F1.copy(X);
        if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
            F1.mul_ip();
            F1.inverse();
            F0.copy(F1); F0.sqr();
        }
        F0.mul_ip(); F0.norm();
        F1.mul(F0);

        F[0]=new ctx.FP2(F0); F[1]=new ctx.FP2(F1); F[2]=new ctx.FP2(F2);
        return F;
    };

    return ECP4;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        ECP4: ECP4
    };
}
