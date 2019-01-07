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

var PAIR192 = function(ctx) {
    "use strict";

    var PAIR192 = {
        /* Line function */
        line: function(A, B, Qx, Qy) {
            var r = new ctx.FP24(1),
                XX, YY, ZZ, YZ, sb,
                X1, Y1, T1, T2,
                a, b, c;

            if (A == B) { /* Doubling */
                XX = new ctx.FP4(A.getx());
                YY = new ctx.FP4(A.gety());
                ZZ = new ctx.FP4(A.getz());
                YZ = new ctx.FP4(YY);

                YZ.mul(ZZ); //YZ
                XX.sqr(); //X^2
                YY.sqr(); //Y^2
                ZZ.sqr(); //Z^2

                YZ.imul(4);
                YZ.neg();
                YZ.norm(); //-2YZ
                YZ.qmul(Qy); //-2YZ.Ys

                XX.imul(6); //3X^2
                XX.qmul(Qx); //3X^2.Xs

                sb = 3 * ctx.ROM_CURVE.CURVE_B_I;
                ZZ.imul(sb);
                if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
                    ZZ.div_2i();
                }
                if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
                    ZZ.times_i();
                    ZZ.add(ZZ);
                    YZ.times_i();
                    YZ.norm();
                }
                ZZ.norm(); // 3b.Z^2

                YY.add(YY);
                ZZ.sub(YY);
                ZZ.norm(); // 3b.Z^2-Y^2

                a = new ctx.FP8(YZ, ZZ); // -2YZ.Ys | 3b.Z^2-Y^2 | 3X^2.Xs
                if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
                    b = new ctx.FP8(XX); // L(0,1) | L(0,0) | L(1,0)
                    c = new ctx.FP8(0);
                }
                if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
                    b = new ctx.FP8(0);
                    c = new ctx.FP8(XX); c.times_i();
                }

                A.dbl();
            } else { /* Addition */
                X1 = new ctx.FP4(A.getx()); // X1
                Y1 = new ctx.FP4(A.gety()); // Y1
                T1 = new ctx.FP4(A.getz()); // Z1
                T2 = new ctx.FP4(A.getz()); // Z1

                T1.mul(B.gety()); // T1=Z1.Y2
                T2.mul(B.getx()); // T2=Z1.X2

                X1.sub(T2);
                X1.norm(); // X1=X1-Z1.X2
                Y1.sub(T1);
                Y1.norm(); // Y1=Y1-Z1.Y2

                T1.copy(X1); // T1=X1-Z1.X2
                X1.qmul(Qy); // X1=(X1-Z1.X2).Ys

                if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
                    X1.times_i();
                    X1.norm();
                }

                T1.mul(B.gety()); // T1=(X1-Z1.X2).Y2

                T2.copy(Y1); // T2=Y1-Z1.Y2
                T2.mul(B.getx()); // T2=(Y1-Z1.Y2).X2
                T2.sub(T1);
                T2.norm(); // T2=(Y1-Z1.Y2).X2 - (X1-Z1.X2).Y2
                Y1.qmul(Qx);
                Y1.neg();
                Y1.norm(); // Y1=-(Y1-Z1.Y2).Xs

                a = new ctx.FP8(X1, T2); // (X1-Z1.X2).Ys  |  (Y1-Z1.Y2).X2 - (X1-Z1.X2).Y2  | - (Y1-Z1.Y2).Xs
                if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.D_TYPE) {
                    b = new ctx.FP8(Y1);
                    c = new ctx.FP8(0);
                }
                if (ctx.ECP.SEXTIC_TWIST == ctx.ECP.M_TYPE) {
                    b = new ctx.FP8(0);
                    c = new ctx.FP8(Y1); c.times_i();
                }

                A.add(B);
            }

            r.set(a, b, c);

            return r;
        },

        /* Optimal R-ate pairing */
        ate: function(P, Q) {
            var x, n, n3, lv,
                Qx, Qy, A, r, nb, bt,
                i;

            x = new ctx.BIG(0);
            x.rcopy(ctx.ROM_CURVE.CURVE_Bnx);
            n = new ctx.BIG(x);

            n3 = new ctx.BIG(n);
            n3.pmul(3);
            n3.norm();

            Qx = new ctx.FP(Q.getx());
            Qy = new ctx.FP(Q.gety());

            A = new ctx.ECP4();
            r = new ctx.FP24(1);

            A.copy(P);
            nb = n3.nbits();

            for (i = nb - 2; i >= 1; i--) {
                r.sqr();
                lv = PAIR192.line(A, A, Qx, Qy);

                r.smul(lv,ctx.ECP.SEXTIC_TWIST);

                bt=n3.bit(i)-n.bit(i);

                if (bt == 1) {
                    lv = PAIR192.line(A, P, Qx, Qy);
                    r.smul(lv,ctx.ECP.SEXTIC_TWIST);
                }
                if (bt == -1) {
                    P.neg();
                    lv = PAIR192.line(A, P, Qx, Qy);
                    r.smul(lv,ctx.ECP.SEXTIC_TWIST);
                    P.neg();
                }
            }

            if (ctx.ECP.SIGN_OF_X == ctx.ECP.NEGATIVEX) {
                r.conj();
            }

            return r;
        },

        /* Optimal R-ate double pairing e(P,Q).e(R,S) */
        ate2: function(P, Q, R, S) {
            var x, n, n3, lv,
                Qx, Qy, Sx, Sy, A, B, r, nb, bt,
                i;


            x = new ctx.BIG(0);
            x.rcopy(ctx.ROM_CURVE.CURVE_Bnx);

            n = new ctx.BIG(x);
            n3 = new ctx.BIG(n);
            n3.pmul(3);
            n3.norm();

            Qx = new ctx.FP(Q.getx());
            Qy = new ctx.FP(Q.gety());

            Sx = new ctx.FP(S.getx());
            Sy = new ctx.FP(S.gety());

            A = new ctx.ECP4();
            B = new ctx.ECP4();
            r = new ctx.FP24(1);

            A.copy(P);
            B.copy(R);
            nb = n3.nbits();

            for (i = nb - 2; i >= 1; i--) {
                r.sqr();
                lv = PAIR192.line(A, A, Qx, Qy);
                r.smul(lv,ctx.ECP.SEXTIC_TWIST);
                lv = PAIR192.line(B, B, Sx, Sy);
                r.smul(lv,ctx.ECP.SEXTIC_TWIST);

                bt=n3.bit(i)-n.bit(i);

                if (bt == 1) {
                    lv = PAIR192.line(A, P, Qx, Qy);
                    r.smul(lv,ctx.ECP.SEXTIC_TWIST);
                    lv = PAIR192.line(B, R, Sx, Sy);
                    r.smul(lv,ctx.ECP.SEXTIC_TWIST);
                }
                if (bt == -1) {
                    P.neg();
                    lv = PAIR192.line(A, P, Qx, Qy);
                    r.smul(lv,ctx.ECP.SEXTIC_TWIST);
                    P.neg();
                    R.neg();
                    lv = PAIR192.line(B, R, Sx, Sy);
                    r.smul(lv,ctx.ECP.SEXTIC_TWIST);
                    R.neg();
                }
            }

            if (ctx.ECP.SIGN_OF_X == ctx.ECP.NEGATIVEX) {
                r.conj();
            }

            return r;
        },

        /* final exponentiation - keep separate for multi-pairings and to avoid thrashing stack */
        fexp: function(m) {
            var fa, fb, f, x, r, lv,
                t0,t1,t2,t3,t4,t5,t6,t7;

            fa = new ctx.BIG(0);
            fa.rcopy(ctx.ROM_FIELD.Fra);
            fb = new ctx.BIG(0);
            fb.rcopy(ctx.ROM_FIELD.Frb);
            f = new ctx.FP2(fa, fb);
            x = new ctx.BIG(0);
            x.rcopy(ctx.ROM_CURVE.CURVE_Bnx);

            r = new ctx.FP24(m);

            /* Easy part of final exp */
            lv = new ctx.FP24(r);
            lv.inverse();
            r.conj();
            r.mul(lv);
            lv.copy(r);
            r.frob(f,4);
            r.mul(lv);

            /* Hard part of final exp */
            // Ghamman & Fouotsa Method
            t7=new ctx.FP24(r); t7.usqr();
            t1=t7.pow(x);

            x.fshr(1);
            t2=t1.pow(x);
            x.fshl(1);

            if (ctx.ECP.SIGN_OF_X==ctx.ECP.NEGATIVEX) {
                t1.conj();
            }
            t3=new ctx.FP24(t1); t3.conj();
            t2.mul(t3);
            t2.mul(r);

            t3=t2.pow(x);
            t4=t3.pow(x);
            t5=t4.pow(x);

            if (ctx.ECP.SIGN_OF_X==ctx.ECP.NEGATIVEX) {
                t3.conj(); t5.conj();
            }

            t3.frob(f,6); t4.frob(f,5);
            t3.mul(t4);

            t6=t5.pow(x);
            if (ctx.ECP.SIGN_OF_X==ctx.ECP.NEGATIVEX) {
                t6.conj();
            }

            t5.frob(f,4);
            t3.mul(t5);

            t0=new ctx.FP24(t2); t0.conj();
            t6.mul(t0);

            t5.copy(t6);
            t5.frob(f,3);

            t3.mul(t5);
            t5=t6.pow(x);
            t6=t5.pow(x);

            if (ctx.ECP.SIGN_OF_X==ctx.ECP.NEGATIVEX) {
                t5.conj();
            }

            t0.copy(t5);
            t0.frob(f,2);
            t3.mul(t0);
            t0.copy(t6);
            t0.frob(f,1);

            t3.mul(t0);
            t5=t6.pow(x);

            if (ctx.ECP.SIGN_OF_X==ctx.ECP.NEGATIVEX) {
                t5.conj();
            }
            t2.frob(f,7);

            t5.mul(t7);
            t3.mul(t2);
            t3.mul(t5);

            r.mul(t3);

            r.reduce();

            return r;
        }
    };

    /* GLV method */
    PAIR192.glv = function(e) {
        var u = [],
            q, x, x2;

        // -(x^2).P = (Beta.x,y)
        q = new ctx.BIG(0);
        q.rcopy(ctx.ROM_CURVE.CURVE_Order);
        x = new ctx.BIG(0);
        x.rcopy(ctx.ROM_CURVE.CURVE_Bnx);
        x2 = ctx.BIG.smul(x, x);
        x = ctx.BIG.smul(x2,x2);
        u[0] = new ctx.BIG(e);
        u[0].mod(x);
        u[1] = new ctx.BIG(e);
        u[1].div(x);
        u[1].rsub(q);

        return u;
    };

    /* Galbraith & Scott Method */
    PAIR192.gs = function(e) {
        var u = [],
            i, q, x, w;

        x = new ctx.BIG(0);
        x.rcopy(ctx.ROM_CURVE.CURVE_Bnx);
        q = new ctx.BIG(0);
        q.rcopy(ctx.ROM_CURVE.CURVE_Order);
        w = new ctx.BIG(e);

        for (i = 0; i < 7; i++) {
            u[i] = new ctx.BIG(w);
            u[i].mod(x);
            w.div(x);
        }

        u[7] = new ctx.BIG(w);
        if (ctx.ECP.SIGN_OF_X==ctx.ECP.NEGATIVEX) {
            u[1].copy(ctx.BIG.modneg(u[1], q));
            u[3].copy(ctx.BIG.modneg(u[3], q));
            u[5].copy(ctx.BIG.modneg(u[5], q));
            u[7].copy(ctx.BIG.modneg(u[7], q));
        }

        return u;
    };

    /* Multiply P by e in group G1 */
    PAIR192.G1mul = function(P, e) {
        var R, Q, q, bcru, cru, t, u, np, nn;

        if (ctx.ROM_CURVE.USE_GLV) {
            P.affine();
            R = new ctx.ECP();
            R.copy(P);
            Q = new ctx.ECP();
            Q.copy(P);
            q = new ctx.BIG(0);
            q.rcopy(ctx.ROM_CURVE.CURVE_Order);
            bcru = new ctx.BIG(0);
            bcru.rcopy(ctx.ROM_CURVE.CURVE_Cru);
            cru = new ctx.FP(bcru);
            t = new ctx.BIG(0);
            u = PAIR192.glv(e);

            Q.getx().mul(cru);

            np = u[0].nbits();
            t.copy(ctx.BIG.modneg(u[0], q));
            nn = t.nbits();
            if (nn < np) {
                u[0].copy(t);
                R.neg();
            }

            np = u[1].nbits();
            t.copy(ctx.BIG.modneg(u[1], q));
            nn = t.nbits();
            if (nn < np) {
                u[1].copy(t);
                Q.neg();
            }
            u[0].norm();
            u[1].norm();
            R = R.mul2(u[0], Q, u[1]);
        } else {
            R = P.mul(e);
        }

        return R;
    };

    /* Multiply P by e in group G2 */
    PAIR192.G2mul = function(P, e) {
        var R, Q, F, q, u, t, i, np, nn;

        if (ctx.ROM_CURVE.USE_GS_G2) {
            Q = [];
            F = ctx.ECP4.frob_constants();

            q = new ctx.BIG(0);
            q.rcopy(ctx.ROM_CURVE.CURVE_Order);

            u = PAIR192.gs(e);
            t = new ctx.BIG(0);
            P.affine();
            Q[0] = new ctx.ECP4();
            Q[0].copy(P);

            for (i = 1; i < 8; i++) {
                Q[i] = new ctx.ECP4();
                Q[i].copy(Q[i - 1]);
                Q[i].frob(F,1);
            }

            for (i = 0; i < 8; i++) {
                np = u[i].nbits();
                t.copy(ctx.BIG.modneg(u[i], q));
                nn = t.nbits();

                if (nn < np) {
                    u[i].copy(t);
                    Q[i].neg();
                }
                u[i].norm();
            }

            R = ctx.ECP4.mul8(Q, u);
        } else {
            R = P.mul(e);
        }
        return R;
    };

    /* Note that this method requires a lot of RAM! Better to use compressed XTR method, see ctx.FP4.js */
    PAIR192.GTpow = function(d, e) {
        var r, g, fa, fb, f, q, t, u, i, np, nn;

        if (ctx.ROM_CURVE.USE_GS_GT) {
            g = [];
            fa = new ctx.BIG(0);
            fa.rcopy(ctx.ROM_FIELD.Fra);
            fb = new ctx.BIG(0);
            fb.rcopy(ctx.ROM_FIELD.Frb);
            f = new ctx.FP2(fa, fb);
            q = new ctx.BIG(0);
            q.rcopy(ctx.ROM_CURVE.CURVE_Order);
            t = new ctx.BIG(0);
            u = PAIR192.gs(e);

            g[0] = new ctx.FP24(d);

            for (i = 1; i < 8; i++) {
                g[i] = new ctx.FP24(0);
                g[i].copy(g[i - 1]);
                g[i].frob(f,1);
            }

            for (i = 0; i < 8; i++) {
                np = u[i].nbits();
                t.copy(ctx.BIG.modneg(u[i], q));
                nn = t.nbits();

                if (nn < np) {
                    u[i].copy(t);
                    g[i].conj();
                }
                u[i].norm();
            }

            r = ctx.FP24.pow8(g, u);
        } else {
            r = d.pow(e);
        }

        return r;
    };

    return PAIR192;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        PAIR192: PAIR192
    };
}
