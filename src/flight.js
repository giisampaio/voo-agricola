// ===== Modelo de voo: turboélice agrícola, números de desempenho do AT-502B =====
// Eixos do corpo (convenção three.js): X = asa direita, Y = cima, Z = cauda. Nariz = -Z.
var D2R = Math.PI / 180, G = 9.80665, RHO = 1.15; // dia quente, ~300 m de elevação
var MS2KT = 1.94384, M2FT = 3.28084;

var AC = {
  S: 29.01, b: 15.85, c: 1.83,            // área, envergadura, corda
  mZero: 2200,                            // vazio com equipamento + piloto + combustível (kg)
  Ixx: 16000, Iyy: 14000, Izz: 28000,
  P: 559000 * 0.72,                       // 750 shp x rendimento da hélice
  Ts: 11000,                              // tração estática (N)
  CL0: 0.25, CLA: 5.2, aStall: 17 * D2R, aStallNeg: -13 * D2R, aWarn: 12 * D2R,
  flapCL: [0, 0.30, 0.68], flapCD: [0, 0.012, 0.045],
  CD0: 0.050, K: 0.047,
  CMA: -0.9, CMQ: -14, CMDE: 0.16,
  CLDA: 0.05, CLP: -0.45, CLB: -0.06, CLR: 0.06,
  CNB: 0.09, CNR: -0.13, CNDR: 0.05, CNDA: -0.004,
  CYB: -0.6,
  thetaGround: 9 * D2R,
  gear: [[-1.45, -1.9, -1.3], [1.45, -1.9, -1.3], [0, -1.0, 4.3]],
  tips: [[-7.9, -0.4, 0], [7.9, -0.4, 0]],
  nose: [0, -1.3, -4.8]
};

function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function sstep(x, a, b) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function sigm(x) { return 1 / (1 + Math.exp(-x)); }

function aeroCoef(a, flap, pow) {
  var fi = Math.min(1, Math.floor(flap)), ff = flap - fi;
  var fCL = AC.flapCL[fi] + (AC.flapCL[fi + 1] - AC.flapCL[fi]) * ff, fCD = AC.flapCD[fi] + (AC.flapCD[fi + 1] - AC.flapCD[fi]) * ff;
  var cl0 = AC.CL0 + fCL;
  var lin = cl0 + AC.CLA * a;
  var sig = a > 0 ? sigm((a - AC.aStall) / (1.2 * D2R)) : sigm((AC.aStallNeg - a) / (1.2 * D2R));
  var fp = 1.4 * Math.sin(2 * a) + 0.3 * fCL;
  var CL = lin * (1 - sig) + fp * sig;
  var sa = Math.sin(a);
  var CD = AC.CD0 + fCD + AC.K * CL * CL + sig * 1.2 * sa * sa + 0.012 * (1 - pow);
  return { CL: CL, CD: CD, sig: sig, cl0: cl0 };
}

function thrust(V, pow) {
  var pf = 0.04 + 0.96 * pow;
  var a = AC.Ts * pf, b = AC.P * pf / Math.max(V, 1);
  return 1 / Math.cbrt(1 / (a * a * a) + 1 / (b * b * b));
}

function Flight() {
  this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.quat = new THREE.Quaternion();
  this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
  this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
  this.reset({ x: 0, z: 0, psi: 0, hopper: 0 });
}

Flight.prototype.reset = function (o) {
  this.psi = o.psi || 0; this.theta = AC.thetaGround; this.phi = 0;
  this.onGround = true; this.vf = 0; this.p = 0; this.q = 0; this.r = 0;
  this.pow = 0; this.rev = 0; this.flap = o.flap || 0; this.flapPos = this.flap; this.hopper = o.hopper || 0;
  this.alphaTrim = 0; this.alpha = 0; this.beta = 0; this.V = 0; this.nz = 1; this.sig = 0;
  this.gamma = 0; this.crashed = null; this.dropSign = 1; this.groundY = 0; this.airTime = 0;
  this.de = 0; this.da = 0; this.dr = 0; this.agl = 0; this.hasFlown = false; this.gI = 0;
  this.pos.set(o.x, 0, o.z); this.vel.set(0, 0, 0);
  this._placeOnGround(); this._setQuat();
};
Flight.prototype.mass = function () { return AC.mZero + this.hopper; };
Flight.prototype._setQuat = function () {
  this._e.set(this.theta, -this.psi, -this.phi, 'YXZ'); this.quat.setFromEuler(this._e);
};
Flight.prototype._placeOnGround = function () {
  this.pos.y = this.groundY + 1.9 * Math.cos(this.theta) - 1.3 * Math.sin(this.theta);
};
Flight.prototype._readAttitude = function () {
  var f = this._a.set(0, 0, -1).applyQuaternion(this.quat);
  this.theta = Math.asin(clamp(f.y, -1, 1)); this.psi = Math.atan2(f.x, -f.z);
  var r = this._b.set(1, 0, 0).applyQuaternion(this.quat), u = this._c.set(0, 1, 0).applyQuaternion(this.quat);
  this.phi = Math.atan2(-r.y, u.y);
};
Flight.prototype.worldPoint = function (l, out) {
  return out.set(l[0], l[1], l[2]).applyQuaternion(this.quat).add(this.pos);
};

Flight.prototype.step = function (dt, c, wind) {
  if (this.crashed) return;
  var rv = this.onGround ? (c.reverse || 0) : 0;                 // reverso bloqueado em voo
  var tgt = Math.max(c.throttle, rv * 0.7), tau = tgt > this.pow ? 1.1 : 0.7;
  this.pow += (tgt - this.pow) * Math.min(1, dt / tau);
  this.rev += (rv - this.rev) * Math.min(1, dt / 0.5);
  this.flapPos += clamp(this.flap - this.flapPos, -dt / 1.5, dt / 1.5);
  if (this.onGround) this._ground(dt, c, wind); else this._air(dt, c, wind);
};

Flight.prototype._ground = function (dt, c, wind) {
  var m = this.mass(), W = m * G;
  var fx = Math.sin(this.psi), fz = -Math.cos(this.psi);
  var head = -(wind.x * fx + wind.z * fz);
  var Va = Math.max(0, this.vf + head);
  var qb = 0.5 * RHO * Va * Va;
  var co = aeroCoef(this.theta, this.flapPos, this.pow);
  var L = qb * AC.S * co.CL, D = qb * AC.S * co.CD, T = thrust(Va, this.pow) * (1 - 1.5 * this.rev);
  var N = Math.max(0, W - L);
  var brk = c.brake || 0, mu = (c.mu || 0.045) + 0.36 * brk;
  var dir = this.vf > 0.05 ? 1 : (this.vf < -0.05 ? -1 : 0), F = T - D * (dir < 0 ? -1 : 1);
  if (dir === 0 && Math.abs(F) <= mu * N) this.vf = 0;
  else {
    var nv = this.vf + (F - mu * N * (dir || (F > 0 ? 1 : -1))) / m * dt;
    if (dir !== 0 && nv * dir < 0 && Math.abs(F) <= mu * N) nv = 0;       // atrito para o avião, não inverte o movimento
    this.vf = Math.max(nv, -3);
  }
  // direção pela bequilha / leme
  var av = Math.abs(this.vf), steer = clamp((c.yaw || 0) + c.roll * 0.6, -1, 1);
  var yr = steer * 0.55 * (1 + 0.8 * brk / (1 + av / 6)) * Math.min(1, av / 5) / (1 + av / 22) * (this.vf < 0 ? -1 : 1);
  this.psi += yr * dt;
  // cauda sobe com a velocidade; profundor gira o avião
  var s = sstep(Va, 16, 30);
  var tgt = AC.thetaGround * (1 - s) + 1.5 * D2R * s + s * (c.pitch > 0 ? c.pitch * 7.5 : c.pitch * 3) * D2R;
  var rate = 10 * D2R * dt;
  this.theta += clamp(tgt - this.theta, -rate, rate);
  this.phi = 0;
  fx = Math.sin(this.psi); fz = -Math.cos(this.psi);
  this.pos.x += fx * this.vf * dt; this.pos.z += fz * this.vf * dt;
  this._placeOnGround(); this._setQuat();
  this.vel.set(fx * this.vf, 0, fz * this.vf);
  this.V = Va; this.alpha = this.theta; this.beta = 0; this.nz = 1; this.sig = co.sig; this.gamma = 0; this.agl = 0;
  this.de = c.pitch; this.da = c.roll; this.dr = steer;
  if (Va > 22 && this.rev < 0.05 && L * Math.cos(this.theta) + T * Math.sin(this.theta) > W) {
    this.onGround = false; this.vel.y = 0.6; this.pos.y += 0.03;
    this.p = this.q = this.r = 0; this.alphaTrim = this.theta; this.airTime = 0;
  }
};

Flight.prototype._air = function (dt, c, wind) {
  var m = this.mass(), W = m * G;
  this.airTime += dt; if (this.airTime > 3) this.hasFlown = true;
  var qi = this._q.copy(this.quat).invert();
  var vb = this._a.copy(this.vel).sub(wind).applyQuaternion(qi);
  var V = Math.max(vb.length(), 1), u = -vb.z;
  var alpha = Math.atan2(-vb.y, u), beta = Math.asin(clamp(vb.x / V, -1, 1));
  var qb = 0.5 * RHO * V * V, qS = qb * AC.S;
  var co = aeroCoef(alpha, this.flapPos, this.pow);
  var L = qS * co.CL, D = qS * co.CD, Y = qS * AC.CYB * beta, T = thrust(V, this.pow) * (1 - 1.5 * this.rev);
  var n = Math.sqrt(u * u + vb.y * vb.y) || 1;
  // força no corpo
  var Fb = this._b.set(Y - D * vb.x / V, L * u / n - D * vb.y / V, L * vb.y / n - D * vb.z / V - T);
  Fb.applyQuaternion(this.quat); Fb.y -= W;
  var sp = this.vel.length();
  this.gamma = sp > 1 ? Math.asin(clamp(this.vel.y / sp, -1, 1)) : 0;

  // ---- comandos ----
  var de, da;
  if (c.assist) {
    // taxa de arfagem própria da curva (não deve ser amortecida nem contada como erro)
    var ph = clamp(this.phi, -1.2, 1.2), qTurn = G * Math.sin(ph) * Math.tan(ph) / V;
    var ge = c.pitch * 25 * D2R - this.gamma;
    this.gI = clamp((this.gI || 0) + ge * dt * 1.5, -0.3, 0.3);
    de = 4.5 * ge + this.gI - 0.4 * (this.q - qTurn) - AC.CMQ * qTurn * (AC.c / (2 * V)) / AC.CMDE;
    if (alpha > AC.aWarn) de -= (alpha - AC.aWarn) * 10;
    de = clamp(de, -1, 1);
    da = clamp(2.4 * (c.roll * 65 * D2R - this.phi) - 0.45 * this.p, -1, 1);
  } else { de = clamp(c.pitch, -1, 1); da = clamp(c.roll, -1, 1); }
  // compensador automático (mantém ~1 g com o manche neutro)
  var nReq = Math.cos(this.gamma) * (c.assist ? 1 / Math.max(Math.cos(this.phi), 0.4) : 1);
  var a1 = clamp((nReq * W / qS - co.cl0) / AC.CLA, -3 * D2R, 11 * D2R);
  this.alphaTrim += (a1 - this.alphaTrim) * Math.min(1, dt / (c.assist ? 0.6 : 1.5));
  var ped = c.yaw || 0;                                           // pedal vence a coordenação automática: glissada/derrapagem
  var dr = clamp(0.45 * ped + (1 - Math.abs(ped)) * 4 * beta - 0.6 * this.r, -1, 1);
  var eff = 1 - 0.6 * co.sig;

  var b2V = AC.b / (2 * V), c2V = AC.c / (2 * V);
  var Cl = AC.CLDA * da * eff + AC.CLP * this.p * b2V + AC.CLB * beta + AC.CLR * this.r * b2V;
  if (co.sig > 0.25) {
    if (this.sig <= 0.25) this.dropSign = Math.random() < 0.5 ? -1 : 1;
    Cl += co.sig * 0.035 * this.dropSign;                       // queda de asa no estol
  }
  var Cm = AC.CMA * (alpha - this.alphaTrim) + AC.CMQ * this.q * c2V + AC.CMDE * de * eff;
  var Cn = AC.CNB * beta + AC.CNR * this.r * b2V + AC.CNDR * dr + AC.CNDA * da;
  this.p += qS * AC.b * Cl / AC.Ixx * dt;
  this.q += qS * AC.c * Cm / AC.Iyy * dt;
  this.r += qS * AC.b * Cn / AC.Izz * dt;

  // integra atitude (taxas no corpo: arfagem +X, guinada dir = -Y, rolagem dir = -Z)
  var wx = this.q, wy = -this.r, wz = -this.p;
  var wn = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (wn > 1e-7) {
    var h = wn * dt * 0.5, sn = Math.sin(h) / wn;
    this._q.set(wx * sn, wy * sn, wz * sn, Math.cos(h));
    this.quat.multiply(this._q).normalize();
  }
  this.vel.addScaledVector(Fb, dt / m);
  this.pos.addScaledVector(this.vel, dt);
  this._readAttitude();
  this.V = V; this.alpha = alpha; this.beta = beta; this.nz = L / W; this.sig = co.sig;
  this.de = de; this.da = da; this.dr = dr;

  // ---- contato com o solo ----
  var low = 1e9, which = -1, i, pt = this._c;
  var pts = [AC.gear[0], AC.gear[1], AC.gear[2], AC.tips[0], AC.tips[1], AC.nose];
  for (i = 0; i < 6; i++) { var y = this.worldPoint(pts[i], pt).y; if (y < low) { low = y; which = i; } }
  this.agl = low - this.groundY;
  if (this.agl <= 0) {
    var sink = -this.vel.y;
    var fx = Math.sin(this.psi), fz = -Math.cos(this.psi);
    var vfw = this.vel.x * fx + this.vel.z * fz;
    var side = Math.abs(this.vel.x * fz - this.vel.z * fx);
    if (which === 3 || which === 4 || Math.abs(this.phi) > 11 * D2R) this.crashed = 'Asa tocou o solo';
    else if (which === 5 || this.theta < -4 * D2R) this.crashed = 'Hélice no solo';
    else if (sink > 3.6) this.crashed = 'Pouso duro: ' + Math.round(sink * 196.85) + ' ft/min';
    else if (side > 9) this.crashed = 'Tocou o solo derrapando';
    else {
      this.onGround = true; this.vf = Math.max(0, vfw);
      this.theta = clamp(this.theta, -2 * D2R, AC.thetaGround); this.phi = 0;
      this.p = this.q = this.r = 0; this._placeOnGround(); this._setQuat(); this.agl = 0;
    }
    if (this.crashed) { this.pos.y += -this.agl; this.vel.set(0, 0, 0); }
  }
};

if (typeof module !== 'undefined') module.exports = { Flight: Flight, AC: AC, aeroCoef: aeroCoef, thrust: thrust, D2R: D2R, MS2KT: MS2KT, M2FT: M2FT, RHO: RHO };
