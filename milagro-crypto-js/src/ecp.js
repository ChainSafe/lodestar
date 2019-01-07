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

/* Elliptic Curve Point class */

var ECP = function(ctx) {
    "use strict";

    /* Constructor */
    var ECP = function() {
        this.x = new ctx.FP(0);
        this.y = new ctx.FP(1);
        if (ECP.CURVETYPE != ECP.EDWARDS) {
            this.z = new ctx.FP(0);
        } else {
            this.z = new ctx.FP(1);
        }
    };

    ECP.WEIERSTRASS = 0;
    ECP.EDWARDS = 1;
    ECP.MONTGOMERY = 2;
    ECP.NOT = 0;
    ECP.BN = 1;
    ECP.BLS = 2;
    ECP.D_TYPE = 0;
    ECP.M_TYPE = 1;
    ECP.POSITIVEX = 0;
    ECP.NEGATIVEX = 1;

    ECP.CURVETYPE = ctx.config["@CT"];
    ECP.CURVE_PAIRING_TYPE = ctx.config["@PF"];
    ECP.SEXTIC_TWIST = ctx.config["@ST"];
    ECP.SIGN_OF_X = ctx.config["@SX"];

    ECP.HASH_TYPE = ctx.config["@HT"];
    ECP.AESKEY = ctx.config["@AK"];

    ECP.prototype = {
        /* test this=O point-at-infinity */
        is_infinity: function() {
            this.x.reduce();
            this.z.reduce();

            if (ECP.CURVETYPE == ECP.EDWARDS) {
                this.y.reduce();
                return (this.x.iszilch() && this.y.equals(this.z));
            } else if (ECP.CURVETYPE == ECP.WEIERSTRASS) {
                this.y.reduce();
                return (this.x.iszilch() && this.z.iszilch());
            } else if (ECP.CURVETYPE == ECP.MONTGOMERY) {
                return (this.z.iszilch());
            }

            return true;
        },

        /* conditional swap of this and Q dependant on d */
        cswap: function(Q, d) {
            this.x.cswap(Q.x, d);
            if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                this.y.cswap(Q.y, d);
            }
            this.z.cswap(Q.z, d);
        },

        /* conditional move of Q to P dependant on d */
        cmove: function(Q, d) {
            this.x.cmove(Q.x, d);
            if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                this.y.cmove(Q.y, d);
            }
            this.z.cmove(Q.z, d);
        },

        /* Constant time select from pre-computed table */
        select: function(W, b) {
            var MP = new ECP(),
                m = b >> 31,
                babs = (b ^ m) - m;

            babs = (babs - 1) / 2;

            this.cmove(W[0], ECP.teq(babs, 0)); // conditional move
            this.cmove(W[1], ECP.teq(babs, 1));
            this.cmove(W[2], ECP.teq(babs, 2));
            this.cmove(W[3], ECP.teq(babs, 3));
            this.cmove(W[4], ECP.teq(babs, 4));
            this.cmove(W[5], ECP.teq(babs, 5));
            this.cmove(W[6], ECP.teq(babs, 6));
            this.cmove(W[7], ECP.teq(babs, 7));

            MP.copy(this);
            MP.neg();
            this.cmove(MP, (m & 1));
        },

        /* Test P == Q */

        equals: function(Q) {
            var a, b;

            a = new ctx.FP(0);
            b = new ctx.FP(0);
            a.copy(this.x);
            a.mul(Q.z);
            a.reduce();
            b.copy(Q.x);
            b.mul(this.z);
            b.reduce();

            if (!a.equals(b)) {
                return false;
            }

            if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                a.copy(this.y);
                a.mul(Q.z);
                a.reduce();
                b.copy(Q.y);
                b.mul(this.z);
                b.reduce();
                if (!a.equals(b)) {
                    return false;
                }
            }

            return true;
        },

        /* copy this=P */
        copy: function(P) {
            this.x.copy(P.x);
            if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                this.y.copy(P.y);
            }
            this.z.copy(P.z);
        },

        /* this=-this */
        neg: function() {
            if (ECP.CURVETYPE == ECP.WEIERSTRASS) {
                this.y.neg();
                this.y.norm();
            } else if (ECP.CURVETYPE == ECP.EDWARDS) {
                this.x.neg();
                this.x.norm();
            }

            return;
        },

        /* set this=O */
        inf: function() {
            this.x.zero();

            if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                this.y.one();
            }

            if (ECP.CURVETYPE != ECP.EDWARDS) {
                this.z.zero();
            } else {
                this.z.one();
            }
        },

        /* set this=(x,y) where x and y are BIGs */
        setxy: function(ix, iy) {
            var rhs, y2;

            this.x = new ctx.FP(0);
            this.x.bcopy(ix);

            this.y = new ctx.FP(0);
            this.y.bcopy(iy);
            this.z = new ctx.FP(1);
            rhs = ECP.RHS(this.x);

            if (ECP.CURVETYPE == ECP.MONTGOMERY) {
                if (rhs.jacobi() != 1) {
                    this.inf();
                }
            } else {
                y2 = new ctx.FP(0);
                y2.copy(this.y);
                y2.sqr();

                if (!y2.equals(rhs)) {
                    this.inf();
                }
            }
        },

        /* set this=x, where x is ctx.BIG, y is derived from sign s */
        setxi: function(ix, s) {
            var rhs, ny;

            this.x = new ctx.FP(0);
            this.x.bcopy(ix);
            rhs = ECP.RHS(this.x);
            this.z = new ctx.FP(1);

            if (rhs.jacobi() == 1) {
                ny = rhs.sqrt();
                if (ny.redc().parity() != s) {
                    ny.neg();
                }
                this.y = ny;
            } else {
                this.inf();
            }
        },

        /* set this=x, y calculated from curve equation */
        setx: function(ix) {
            var rhs;

            this.x = new ctx.FP(0);
            this.x.bcopy(ix);
            rhs = ECP.RHS(this.x);
            this.z = new ctx.FP(1);

            if (rhs.jacobi() == 1) {
                if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                    this.y = rhs.sqrt();
                }
            } else {
                this.inf();
            }
        },

        /* set this to affine - from (x,y,z) to (x,y) */
        affine: function() {
            var one;

            if (this.is_infinity()) {
                return;
            }

            one = new ctx.FP(1);

            if (this.z.equals(one)) {
                return;
            }

            this.z.inverse();

            if (ECP.CURVETYPE == ECP.EDWARDS || ECP.CURVETYPE == ECP.WEIERSTRASS) {
                this.x.mul(this.z);
                this.x.reduce();
                this.y.mul(this.z);
                this.y.reduce();
                this.z = one;
            }
            if (ECP.CURVETYPE == ECP.MONTGOMERY) {
                this.x.mul(this.z);
                this.x.reduce();
                this.z = one;
            }
        },

        /* extract x as ctx.BIG */
        getX: function() {
            this.affine();
            return this.x.redc();
        },

        /* extract y as ctx.BIG */
        getY: function() {
            this.affine();
            return this.y.redc();
        },

        /* get sign of Y */
        getS: function() {
            this.affine();
            var y = this.getY();
            return y.parity();
        },

        /* extract x as ctx.FP */
        getx: function() {
            return this.x;
        },

        /* extract y as ctx.FP */
        gety: function() {
            return this.y;
        },

        /* extract z as ctx.FP */
        getz: function() {
            return this.z;
        },

        /* convert to byte array */
        toBytes: function(b) {
            var t = [],
                i;

            if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                b[0] = 0x04;
            } else {
                b[0] = 0x02;
            }

            this.affine();
            this.x.redc().toBytes(t);

            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                b[i + 1] = t[i];
            }

            if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                this.y.redc().toBytes(t);
                for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                    b[i + ctx.BIG.MODBYTES + 1] = t[i];
                }
            }
        },
        /* convert to hex string */
        toString: function() {
            if (this.is_infinity()) {
                return "infinity";
            }

            this.affine();

            if (ECP.CURVETYPE == ECP.MONTGOMERY) {
                return "(" + this.x.redc().toString() + ")";
            } else {
                return "(" + this.x.redc().toString() + "," + this.y.redc().toString() + ")";
            }
        },

        /* this+=this */
        dbl: function() {
            var t0, t1, t2, t3, x3, y3, z3, b,
                C, D, H, J,
                A, B, AA, BB;

            if (ECP.CURVETYPE == ECP.WEIERSTRASS) {

                if (ctx.ROM_CURVE.CURVE_A == 0) {
                    t0 = new ctx.FP(0);
                    t0.copy(this.y);
                    t0.sqr();
                    t1 = new ctx.FP(0);
                    t1.copy(this.y);
                    t1.mul(this.z);
                    t2 = new ctx.FP(0);
                    t2.copy(this.z);
                    t2.sqr();

                    this.z.copy(t0);
                    this.z.add(t0);
                    this.z.norm();
                    this.z.add(this.z);
                    this.z.add(this.z);
                    this.z.norm();

                    t2.imul(3 * ctx.ROM_CURVE.CURVE_B_I);

                    x3 = new ctx.FP(0);
                    x3.copy(t2);
                    x3.mul(this.z);
                    y3 = new ctx.FP(0);
                    y3.copy(t0);
                    y3.add(t2);
                    y3.norm();
                    this.z.mul(t1);
                    t1.copy(t2);
                    t1.add(t2);
                    t2.add(t1);
                    t0.sub(t2);
                    t0.norm();
                    y3.mul(t0);
                    y3.add(x3);
                    t1.copy(this.x);
                    t1.mul(this.y);
                    this.x.copy(t0);
                    this.x.norm();
                    this.x.mul(t1);
                    this.x.add(this.x);

                    this.x.norm();
                    this.y.copy(y3);
                    this.y.norm();
                } else {
                    t0 = new ctx.FP(0);
                    t0.copy(this.x);
                    t1 = new ctx.FP(0);
                    t1.copy(this.y);
                    t2 = new ctx.FP(0);
                    t2.copy(this.z);
                    t3 = new ctx.FP(0);
                    t3.copy(this.x);
                    z3 = new ctx.FP(0);
                    z3.copy(this.z);
                    y3 = new ctx.FP(0);
                    x3 = new ctx.FP(0);
                    b = new ctx.FP(0);
                    if (ctx.ROM_CURVE.CURVE_B_I == 0) {
                        b.rcopy(ctx.ROM_CURVE.CURVE_B);
                    }
                    t0.sqr(); //1    x^2
                    t1.sqr(); //2    y^2
                    t2.sqr(); //3

                    t3.mul(this.y); //4
                    t3.add(t3);
                    t3.norm(); //5
                    z3.mul(this.x); //6
                    z3.add(z3);
                    z3.norm(); //7
                    y3.copy(t2);

                    if (ctx.ROM_CURVE.CURVE_B_I == 0) {
                        y3.mul(b); //8
                    } else {
                        y3.imul(ctx.ROM_CURVE.CURVE_B_I);
                    }

                    y3.sub(z3); //9  ***
                    x3.copy(y3);
                    x3.add(y3);
                    x3.norm(); //10

                    y3.add(x3); //11
                    x3.copy(t1);
                    x3.sub(y3);
                    x3.norm(); //12
                    y3.add(t1);
                    y3.norm(); //13
                    y3.mul(x3); //14
                    x3.mul(t3); //15
                    t3.copy(t2);
                    t3.add(t2); //16
                    t2.add(t3); //17

                    if (ctx.ROM_CURVE.CURVE_B_I == 0) {
                        z3.mul(b); //18
                    } else {
                        z3.imul(ctx.ROM_CURVE.CURVE_B_I);
                    }

                    z3.sub(t2); //19
                    z3.sub(t0);
                    z3.norm(); //20  ***
                    t3.copy(z3);
                    t3.add(z3); //21

                    z3.add(t3);
                    z3.norm(); //22
                    t3.copy(t0);
                    t3.add(t0); //23
                    t0.add(t3); //24
                    t0.sub(t2);
                    t0.norm(); //25

                    t0.mul(z3); //26
                    y3.add(t0); //27
                    t0.copy(this.y);
                    t0.mul(this.z); //28
                    t0.add(t0);
                    t0.norm(); //29
                    z3.mul(t0); //30
                    x3.sub(z3); //31
                    t0.add(t0);
                    t0.norm(); //32
                    t1.add(t1);
                    t1.norm(); //33
                    z3.copy(t0);
                    z3.mul(t1); //34
                    this.x.copy(x3);
                    this.x.norm();
                    this.y.copy(y3);
                    this.y.norm();
                    this.z.copy(z3);
                    this.z.norm();
                }
            }

            if (ECP.CURVETYPE == ECP.EDWARDS) {
                C = new ctx.FP(0);
                C.copy(this.x);
                D = new ctx.FP(0);
                D.copy(this.y);
                H = new ctx.FP(0);
                H.copy(this.z);
                J = new ctx.FP(0);
                this.x.mul(this.y);
                this.x.add(this.x);
                this.x.norm();
                C.sqr();
                D.sqr();
                if (ctx.ROM_CURVE.CURVE_A == -1) {
                    C.neg();
                }

                this.y.copy(C);
                this.y.add(D);
                this.y.norm();
                H.sqr();
                H.add(H);

                this.z.copy(this.y);
                J.copy(this.y);

                J.sub(H);
                J.norm();

                this.x.mul(J);
                C.sub(D);
                C.norm();
                this.y.mul(C);
                this.z.mul(J);
            }

            if (ECP.CURVETYPE == ECP.MONTGOMERY) {
                A = new ctx.FP(0);
                A.copy(this.x);
                B = new ctx.FP(0);
                B.copy(this.x);
                AA = new ctx.FP(0);
                BB = new ctx.FP(0);
                C = new ctx.FP(0);

                A.add(this.z);
                A.norm();
                AA.copy(A);
                AA.sqr();
                B.sub(this.z);
                B.norm();
                BB.copy(B);
                BB.sqr();
                C.copy(AA);
                C.sub(BB);
                C.norm();
                this.x.copy(AA);
                this.x.mul(BB);

                A.copy(C);
                A.imul((ctx.ROM_CURVE.CURVE_A + 2) >> 2);

                BB.add(A);
                BB.norm();
                this.z.copy(BB);
                this.z.mul(C);
            }

            return;
        },

        /* this+=Q */
        add: function(Q) {
            var b, t0, t1, t2, t3, t4, x3, y3, z3,
                A, B, C, D, E, F, G;

            if (ECP.CURVETYPE == ECP.WEIERSTRASS) {
                if (ctx.ROM_CURVE.CURVE_A == 0) {

                    b = 3 * ctx.ROM_CURVE.CURVE_B_I;
                    t0 = new ctx.FP(0);
                    t0.copy(this.x);
                    t0.mul(Q.x);
                    t1 = new ctx.FP(0);
                    t1.copy(this.y);
                    t1.mul(Q.y);
                    t2 = new ctx.FP(0);
                    t2.copy(this.z);
                    t2.mul(Q.z);
                    t3 = new ctx.FP(0);
                    t3.copy(this.x);
                    t3.add(this.y);
                    t3.norm();
                    t4 = new ctx.FP(0);
                    t4.copy(Q.x);
                    t4.add(Q.y);
                    t4.norm();
                    t3.mul(t4);
                    t4.copy(t0);
                    t4.add(t1);

                    t3.sub(t4);
                    t3.norm();
                    t4.copy(this.y);
                    t4.add(this.z);
                    t4.norm();
                    x3 = new ctx.FP(0);
                    x3.copy(Q.y);
                    x3.add(Q.z);
                    x3.norm();

                    t4.mul(x3);
                    x3.copy(t1);
                    x3.add(t2);

                    t4.sub(x3);
                    t4.norm();
                    x3.copy(this.x);
                    x3.add(this.z);
                    x3.norm();
                    y3 = new ctx.FP(0);
                    y3.copy(Q.x);
                    y3.add(Q.z);
                    y3.norm();
                    x3.mul(y3);
                    y3.copy(t0);
                    y3.add(t2);
                    y3.rsub(x3);
                    y3.norm();
                    x3.copy(t0);
                    x3.add(t0);
                    t0.add(x3);
                    t0.norm();
                    t2.imul(b);

                    z3 = new ctx.FP(0);
                    z3.copy(t1);
                    z3.add(t2);
                    z3.norm();
                    t1.sub(t2);
                    t1.norm();
                    y3.imul(b);

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
                } else {
                    t0 = new ctx.FP(0);
                    t0.copy(this.x);
                    t1 = new ctx.FP(0);
                    t1.copy(this.y);
                    t2 = new ctx.FP(0);
                    t2.copy(this.z);
                    t3 = new ctx.FP(0);
                    t3.copy(this.x);
                    t4 = new ctx.FP(0);
                    t4.copy(Q.x);
                    z3 = new ctx.FP(0);
                    y3 = new ctx.FP(0);
                    y3.copy(Q.x);
                    x3 = new ctx.FP(0);
                    x3.copy(Q.y);
                    b = new ctx.FP(0);

                    if (ctx.ROM_CURVE.CURVE_B_I == 0) {
                        b.rcopy(ctx.ROM_CURVE.CURVE_B);
                    }
                    t0.mul(Q.x); //1
                    t1.mul(Q.y); //2
                    t2.mul(Q.z); //3

                    t3.add(this.y);
                    t3.norm(); //4
                    t4.add(Q.y);
                    t4.norm(); //5
                    t3.mul(t4); //6
                    t4.copy(t0);
                    t4.add(t1); //7
                    t3.sub(t4);
                    t3.norm(); //8
                    t4.copy(this.y);
                    t4.add(this.z);
                    t4.norm(); //9
                    x3.add(Q.z);
                    x3.norm(); //10
                    t4.mul(x3); //11
                    x3.copy(t1);
                    x3.add(t2); //12

                    t4.sub(x3);
                    t4.norm(); //13
                    x3.copy(this.x);
                    x3.add(this.z);
                    x3.norm(); //14
                    y3.add(Q.z);
                    y3.norm(); //15

                    x3.mul(y3); //16
                    y3.copy(t0);
                    y3.add(t2); //17

                    y3.rsub(x3);
                    y3.norm(); //18
                    z3.copy(t2);

                    if (ctx.ROM_CURVE.CURVE_B_I == 0) {
                        z3.mul(b); //18
                    } else {
                        z3.imul(ctx.ROM_CURVE.CURVE_B_I);
                    }

                    x3.copy(y3);
                    x3.sub(z3);
                    x3.norm(); //20
                    z3.copy(x3);
                    z3.add(x3); //21

                    x3.add(z3); //22
                    z3.copy(t1);
                    z3.sub(x3);
                    z3.norm(); //23
                    x3.add(t1);
                    x3.norm(); //24

                    if (ctx.ROM_CURVE.CURVE_B_I == 0) {
                        y3.mul(b); //18
                    } else {
                        y3.imul(ctx.ROM_CURVE.CURVE_B_I);
                    }

                    t1.copy(t2);
                    t1.add(t2); //26
                    t2.add(t1); //27

                    y3.sub(t2); //28

                    y3.sub(t0);
                    y3.norm(); //29
                    t1.copy(y3);
                    t1.add(y3); //30
                    y3.add(t1);
                    y3.norm(); //31

                    t1.copy(t0);
                    t1.add(t0); //32
                    t0.add(t1); //33
                    t0.sub(t2);
                    t0.norm(); //34
                    t1.copy(t4);
                    t1.mul(y3); //35
                    t2.copy(t0);
                    t2.mul(y3); //36
                    y3.copy(x3);
                    y3.mul(z3); //37
                    y3.add(t2); //38
                    x3.mul(t3); //39
                    x3.sub(t1); //40
                    z3.mul(t4); //41
                    t1.copy(t3);
                    t1.mul(t0); //42
                    z3.add(t1);
                    this.x.copy(x3);
                    this.x.norm();
                    this.y.copy(y3);
                    this.y.norm();
                    this.z.copy(z3);
                    this.z.norm();
                }
            }

            if (ECP.CURVETYPE == ECP.EDWARDS) {
                A = new ctx.FP(0);
                A.copy(this.z);
                B = new ctx.FP(0);
                C = new ctx.FP(0);
                C.copy(this.x);
                D = new ctx.FP(0);
                D.copy(this.y);
                E = new ctx.FP(0);
                F = new ctx.FP(0);
                G = new ctx.FP(0);

                A.mul(Q.z); //A=2
                B.copy(A);
                B.sqr(); //B=2
                C.mul(Q.x); //C=2
                D.mul(Q.y); //D=2

                E.copy(C);
                E.mul(D); //E=2

                if (ctx.ROM_CURVE.CURVE_B_I == 0) {
                    b = new ctx.FP(0);
                    b.rcopy(ctx.ROM_CURVE.CURVE_B);
                    E.mul(b);
                } else {
                    E.imul(ctx.ROM_CURVE.CURVE_B_I); //E=22222
                }

                F.copy(B);
                F.sub(E); //F=22224
                G.copy(B);
                G.add(E); //G=22224

                if (ctx.ROM_CURVE.CURVE_A == 1) {
                    E.copy(D);
                    E.sub(C); //E=4
                }
                C.add(D); //C=4

                B.copy(this.x);
                B.add(this.y); //B=4
                D.copy(Q.x);
                D.add(Q.y);
                B.norm();
                D.norm(); //D=4
                B.mul(D); //B=2
                B.sub(C);
                B.norm();
                F.norm(); // B=6
                B.mul(F); //B=2
                this.x.copy(A);
                this.x.mul(B);
                G.norm(); // x=2

                if (ctx.ROM_CURVE.CURVE_A == 1) {
                    E.norm();
                    C.copy(E);
                    C.mul(G); //C=2
                }

                if (ctx.ROM_CURVE.CURVE_A == -1) {
                    C.norm();
                    C.mul(G);
                }

                this.y.copy(A);
                this.y.mul(C); //y=2
                this.z.copy(F);
                this.z.mul(G);
            }

            return;
        },

        /* Differential Add for Montgomery curves. this+=Q where W is this-Q and is affine. */
        dadd: function(Q, W) {
            var A, B, C, D, DA, CB;

            A = new ctx.FP(0);
            A.copy(this.x);
            B = new ctx.FP(0);
            B.copy(this.x);
            C = new ctx.FP(0);
            C.copy(Q.x);
            D = new ctx.FP(0);
            D.copy(Q.x);
            DA = new ctx.FP(0);
            CB = new ctx.FP(0);

            A.add(this.z);
            B.sub(this.z);

            C.add(Q.z);
            D.sub(Q.z);

            D.norm();
            A.norm();
            DA.copy(D);
            DA.mul(A);
            C.norm();
            B.norm();
            CB.copy(C);
            CB.mul(B);

            A.copy(DA);
            A.add(CB);
            A.norm();
            A.sqr();
            B.copy(DA);
            B.sub(CB);
            B.norm();
            B.sqr();

            this.x.copy(A);
            this.z.copy(W.x);
            this.z.mul(B);
        },

        /* this-=Q */
        sub: function(Q) {
            Q.neg();
            this.add(Q);
            Q.neg();
        },

        /* constant time multiply by small integer of length bts - use ladder */
        pinmul: function(e, bts) {
            var i, b, P, R0, R1;

            if (ECP.CURVETYPE == ECP.MONTGOMERY) {
                return this.mul(new ctx.BIG(e));
            } else {
                P = new ECP();
                R0 = new ECP();
                R1 = new ECP();
                R1.copy(this);

                for (i = bts - 1; i >= 0; i--) {
                    b = (e >> i) & 1;
                    P.copy(R1);
                    P.add(R0);
                    R0.cswap(R1, b);
                    R1.copy(P);
                    R0.dbl();
                    R0.cswap(R1, b);
                }

                P.copy(R0);
                P.affine();

                return P;
            }
        },

        // multiply this by the curves cofactor
        cfp: function() {
            var cf=ctx.ROM_CURVE.CURVE_Cof_I,
                c = new ctx.BIG(0);
            if (cf==1) {
                return;
            }
            if (cf==4) {
                this.dbl(); this.dbl();
                this.affine();
                return;
            }
            if (cf==8) {
                this.dbl(); this.dbl(); this.dbl();
                this.affine();
                return;
            }
            c.rcopy(ctx.ROM_CURVE.CURVE_Cof);
            this.copy(this.mul(c));
        },


        /* return e.this - SPA immune, using Ladder */
        mul: function(e) {
            var P, D, R0, R1, mt, t, Q, C, W, w,
                i, b, nb, s, ns;

            if (e.iszilch() || this.is_infinity()) {
                return new ECP();
            }

            P = new ECP();

            if (ECP.CURVETYPE == ECP.MONTGOMERY) { /* use ladder */
                D = new ECP();
                R0 = new ECP();
                R0.copy(this);
                R1 = new ECP();
                R1.copy(this);
                R1.dbl();
                D.copy(this);
                D.affine();
                nb = e.nbits();
                for (i = nb - 2; i >= 0; i--) {
                    b = e.bit(i);
                    P.copy(R1);
                    P.dadd(R0, D);

                    R0.cswap(R1, b);
                    R1.copy(P);
                    R0.dbl();
                    R0.cswap(R1, b);
                }
                P.copy(R0);
            } else {
                // fixed size windows
                mt = new ctx.BIG();
                t = new ctx.BIG();
                Q = new ECP();
                C = new ECP();
                W = [];
                w = [];

                this.affine();

                // precompute table
                Q.copy(this);
                Q.dbl();
                W[0] = new ECP();
                W[0].copy(this);

                for (i = 1; i < 8; i++) {
                    W[i] = new ECP();
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
            }

            P.affine();

            return P;
        },

        /* Return e.this+f.Q */

        mul2: function(e, Q, f) {
            var te = new ctx.BIG(),
                tf = new ctx.BIG(),
                mt = new ctx.BIG(),
                S = new ECP(),
                T = new ECP(),
                C = new ECP(),
                W = [],
                w = [],
                i, s, ns, nb,
                a, b;

            this.affine();
            Q.affine();

            te.copy(e);
            tf.copy(f);

            // precompute table
            W[1] = new ECP();
            W[1].copy(this);
            W[1].sub(Q);
            W[2] = new ECP();
            W[2].copy(this);
            W[2].add(Q);
            S.copy(Q);
            S.dbl();
            W[0] = new ECP();
            W[0].copy(W[1]);
            W[0].sub(S);
            W[3] = new ECP();
            W[3].copy(W[2]);
            W[3].add(S);
            T.copy(this);
            T.dbl();
            W[5] = new ECP();
            W[5].copy(W[1]);
            W[5].add(T);
            W[6] = new ECP();
            W[6].copy(W[2]);
            W[6].add(T);
            W[4] = new ECP();
            W[4].copy(W[5]);
            W[4].sub(S);
            W[7] = new ECP();
            W[7].copy(W[6]);
            W[7].add(S);

            // if multiplier is odd, add 2, else add 1 to multiplier, and add 2P or P to correction

            s = te.parity();
            te.inc(1);
            te.norm();
            ns = te.parity();
            mt.copy(te);
            mt.inc(1);
            mt.norm();
            te.cmove(mt, s);
            T.cmove(this, ns);
            C.copy(T);

            s = tf.parity();
            tf.inc(1);
            tf.norm();
            ns = tf.parity();
            mt.copy(tf);
            mt.inc(1);
            mt.norm();
            tf.cmove(mt, s);
            S.cmove(Q, ns);
            C.add(S);

            mt.copy(te);
            mt.add(tf);
            mt.norm();
            nb = 1 + Math.floor((mt.nbits() + 1) / 2);

            // convert exponent to signed 2-bit window
            for (i = 0; i < nb; i++) {
                a = (te.lastbits(3) - 4);
                te.dec(a);
                te.norm();
                te.fshr(2);
                b = (tf.lastbits(3) - 4);
                tf.dec(b);
                tf.norm();
                tf.fshr(2);
                w[i] = (4 * a + b);
            }
            w[nb] = (4 * te.lastbits(3) + tf.lastbits(3));
            S.copy(W[Math.floor((w[nb] - 1) / 2)]);

            for (i = nb - 1; i >= 0; i--) {
                T.select(W, w[i]);
                S.dbl();
                S.dbl();
                S.add(T);
            }
            S.sub(C); /* apply correction */
            S.affine();

            return S;
        }
    };

    // set to group generator
    ECP.generator = function() {
        var G=new ECP(),
            gx = new ctx.BIG(0),
            gy = new ctx.BIG(0);

        gx.rcopy(ctx.ROM_CURVE.CURVE_Gx);

        if (ctx.ECP.CURVETYPE != ctx.ECP.MONTGOMERY) {
            gy.rcopy(ctx.ROM_CURVE.CURVE_Gy);
            G.setxy(gx, gy);
        } else {
            G.setx(gx);
        }
        return G;
    };

    /* return 1 if b==c, no branching */
    ECP.teq = function(b, c) {
        var x = b ^ c;
        x -= 1; // if x=0, x now -1
        return ((x >> 31) & 1);
    };

    /* convert from byte array to ECP */
    ECP.fromBytes = function(b) {
        var t = [],
            P = new ECP(),
            p = new ctx.BIG(0),
            px, py, i;

        p.rcopy(ctx.ROM_FIELD.Modulus);

        for (i = 0; i < ctx.BIG.MODBYTES; i++) {
            t[i] = b[i + 1];
        }

        px = ctx.BIG.fromBytes(t);
        if (ctx.BIG.comp(px, p) >= 0) {
            return P;
        }

        if (b[0] == 0x04) {
            for (i = 0; i < ctx.BIG.MODBYTES; i++) {
                t[i] = b[i + ctx.BIG.MODBYTES + 1];
            }

            py = ctx.BIG.fromBytes(t);

            if (ctx.BIG.comp(py, p) >= 0) {
                return P;
            }

            P.setxy(px, py);

            return P;
        } else {
            P.setx(px);
            return P;
        }
    };

    /* Calculate RHS of curve equation */
    ECP.RHS = function(x) {
        var r = new ctx.FP(0),
            b, cx, one, x3;

        x.norm();
        r.copy(x);
        r.sqr();

        if (ECP.CURVETYPE == ECP.WEIERSTRASS) { // x^3+Ax+B
            b = new ctx.FP(0);
            b.rcopy(ctx.ROM_CURVE.CURVE_B);
            r.mul(x);
            if (ctx.ROM_CURVE.CURVE_A == -3) {
                cx = new ctx.FP(0);
                cx.copy(x);
                cx.imul(3);
                cx.neg();
                cx.norm();
                r.add(cx);
            }
            r.add(b);
        } else if (ECP.CURVETYPE == ECP.EDWARDS) { // (Ax^2-1)/(Bx^2-1)
            b = new ctx.FP(0);
            b.rcopy(ctx.ROM_CURVE.CURVE_B);

            one = new ctx.FP(1);
            b.mul(r);
            b.sub(one);
            b.norm();
            if (ctx.ROM_CURVE.CURVE_A == -1) {
                r.neg();
            }
            r.sub(one);
            r.norm();
            b.inverse();

            r.mul(b);
        } else if (ECP.CURVETYPE == ECP.MONTGOMERY) { // x^3+Ax^2+x
            x3 = new ctx.FP(0);
            x3.copy(r);
            x3.mul(x);
            r.imul(ctx.ROM_CURVE.CURVE_A);
            r.add(x3);
            r.add(x);
        }

        r.reduce();

        return r;
    };

    ECP.mapit = function(h) {
        var q = new ctx.BIG(0),
            x = ctx.BIG.fromBytes(h),
            P = new ECP();

        q.rcopy(ctx.ROM_FIELD.Modulus);
        x.mod(q);

        for (;;) {
            for (;;) {
                if (ECP.CURVETYPE != ECP.MONTGOMERY) {
                    P.setxi(x,0);
                } else {
                    P.setx(x);
                }
                x.inc(1); x.norm();
                if (!P.is_infinity()){
                    break;
                }

            }
            P.cfp();
            if (!P.is_infinity()) {
                break;
            }
        }
        return P;
    };

    return ECP;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        ECP: ECP
    };
}
