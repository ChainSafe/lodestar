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

/* Test MPIN - test driver and function exerciser for MPIN API Functions */

var CTX = require("../index");

var chai = require('chai');

var expect = chai.expect;

var pf_curves = ['BN254', 'BN254CX', 'BLS381', 'BLS383', 'BLS461', 'FP256BN', 'FP512BN', 'BLS24', 'BLS48'];

pf_curves.forEach(function(curve) {

    describe('TEST PAIR ' + curve, function() {

        var ctx = new CTX(curve),
            rng = new ctx.RAND(),
            r = new ctx.BIG(0),
            G = ctx.ECP.generator(),
            G1 = new ctx.ECP(0),
            G2 = new ctx.ECP(0),
            Gaux = new ctx.ECP(0);

        // Set curve order
        r.rcopy(ctx.ROM_CURVE.CURVE_Order);

        if (ctx.ECP.CURVE_PAIRING_TYPE === 1 | ctx.ECP.CURVE_PAIRING_TYPE === 2) {
            var Q = ctx.ECP2.generator(),
                Q1 = new ctx.ECP2(0),
                Q2 = new ctx.ECP2(0),
                Qaux = new ctx.ECP2(0),
                g11 = new ctx.FP12(0),
                g12 = new ctx.FP12(0),
                g21 = new ctx.FP12(0),
                g22 = new ctx.FP12(0),
                g1s = new ctx.FP12(0),
                gs1 = new ctx.FP12(0),
                aux1 = new ctx.FP12(0),
                aux2 = new ctx.FP12(0);

            // Set pairing interface
            var PAIR = ctx.PAIR;

        } else if (ctx.ECP.CURVE_PAIRING_TYPE === 3) {
            var Q = ctx.ECP4.generator(),
                Q1 = new ctx.ECP4(0),
                Q2 = new ctx.ECP4(0),
                Qaux = new ctx.ECP4(0),

                g11 = new ctx.FP24(0),
                g22 = new ctx.FP24(0),
                g1s = new ctx.FP24(0),
                gs1 = new ctx.FP24(0),
                aux1 = new ctx.FP24(0),
                aux2 = new ctx.FP24(0);

            // Set pairing interface
            var PAIR = ctx.PAIR192;

        } else if (ctx.ECP.CURVE_PAIRING_TYPE === 4) {
            var Q = ctx.ECP8.generator(),
                Q1 = new ctx.ECP8(0),
                Q2 = new ctx.ECP8(0),
                Qaux = new ctx.ECP8(0),

                g11 = new ctx.FP48(0),
                g22 = new ctx.FP48(0),
                g1s = new ctx.FP48(0),
                gs1 = new ctx.FP48(0),
                aux1 = new ctx.FP48(0),
                aux2 = new ctx.FP48(0);

            // Set pairing interface
            PAIR = ctx.PAIR256;
        }

        before(function(done) {
            this.timeout(0);

            var RAW = [];
            rng.clean();
            for (i = 0; i < 100; i++) RAW[i] = i;
            rng.seed(100, RAW);

            // Precompute terms
            x = ctx.BIG.randomnum(r,rng);
            y = ctx.BIG.randomnum(r,rng);
            s = ctx.BIG.randomnum(r,rng);
            G1 = PAIR.G1mul(G,x);
            Q1 = PAIR.G2mul(Q,y);
            sG1 = PAIR.G1mul(G1,s);
            sQ1 = PAIR.G2mul(Q1,s);
            x = ctx.BIG.randomnum(r,rng);
            y = ctx.BIG.randomnum(r,rng);
            G2 = PAIR.G1mul(G,x);
            Q2 = PAIR.G2mul(Q,y);

            g11 = PAIR.ate(Q1, G1);
            g11 = PAIR.fexp(g11);
            g22 = PAIR.ate(Q2, G2);
            g22 = PAIR.fexp(g22);

            if (ctx.ECP.CURVE_PAIRING_TYPE === 1 || ctx.ECP.CURVE_PAIRING_TYPE === 2) {
                g12 = PAIR.ate(Q1, G2);
                g12 = PAIR.fexp(g12);
                g21 = PAIR.ate(Q2, G1);
                g21 = PAIR.fexp(g21);
            }

            done();
        });

        // Test that e(sQ,G) = e(Q,sG) = e(Q,G)^s, s random
        it('test Bilinearity smul', function(done) {
            this.timeout(0);

            g1s = PAIR.ate(Q1, sG1);
            g1s = PAIR.fexp(g1s);
            gs1 = PAIR.ate(sQ1, G1);
            gs1 = PAIR.fexp(gs1);

            expect(g1s.toString()).to.be.equal(gs1.toString());

            gs1 = PAIR.GTpow(g11,s);

            expect(g1s.toString()).to.be.equal(gs1.toString());

            done();
        });

        if (ctx.ECP.CURVE_PAIRING_TYPE === 1 || ctx.ECP.CURVE_PAIRING_TYPE === 2) {
            // Test that e(Q1+Q2,G1) = e(Q1,G1).e(Q2,G1)
            it('test Bilinearity 1st', function(done) {
                this.timeout(0);

                aux1.copy(g11);
                aux1.mul(g21);

                Qaux.copy(Q1);
                Qaux.add(Q2);
                Qaux.affine();

                aux2 = PAIR.ate(Qaux, G1);
                aux2 = PAIR.fexp(aux2);

                expect(aux1.toString()).to.be.equal(aux2.toString());

                done();
            });

            // Test that e(Q1,G1+G2) = e(Q1,G1).e(Q1,G2)
            it('test Bilinearity 2nd', function(done) {
                this.timeout(0);

                aux1.copy(g11);
                aux1.mul(g12);

                Gaux.copy(G1);
                Gaux.add(G2);
                Gaux.affine();

                aux2 = PAIR.ate(Q1, Gaux);
                aux2 = PAIR.fexp(aux2);

                expect(aux1.toString()).to.be.equal(aux2.toString());

                done();
            });
        }

        // Test that ate2 correctly computes e(Q1,G1).e(Q2,G2)
        it('test Double Pairing', function(done) {
            this.timeout(0);

            aux1.copy(g11);
            aux1.mul(g22);

            aux2 = PAIR.ate2(Q1,G1,Q2,G2);
            aux2 = PAIR.fexp(aux2);

            expect(aux1.toString()).to.be.equal(aux2.toString());

            done();
        });
    });
});
