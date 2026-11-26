// ===== Jogo: entrada, HUD, som, laço principal =====
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), canvas = $('gl');
  var show = function (id, on) { $(id).classList.toggle('hidden', !on); };
  var renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { $('menu-note').textContent = 'Este navegador não liberou gráficos 3D (WebGL).'; return; }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  var PR = Math.min(window.devicePixelRatio || 1, 2); renderer.setPixelRatio(PR);
  var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(62, 2, 1, 12000);
  var world = buildWorld(scene, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  var plane = buildAircraft(); scene.add(plane.group);
  var spray = makeSpray(scene);
  var fire = makePuffs(scene, 500, { additive: true, c0: '#ffe9a0', c1: '#ff4a0a', alpha: 0.85, drag: 2.5, rise: 5 });
  var smoke = makePuffs(scene, 700, { additive: false, c0: '#141312', c1: '#5c5a57', alpha: 0.6, drag: 1.2, rise: 2.2 });
  var debris = [], wreckT = 0;
  var flight = new Flight();

  // ---------- estado ----------
  var state = 'menu', mode = 'stick', camMode = 0, spraying = false, throttle = 0;
  var opt = { assist: true, sens: 1, invert: false, sound: true };
  var ctl = { throttle: 0, reverse: 0, brake: 0, yaw: 0, pitch: 0, roll: 0, assist: true, mu: 0.045 };
  var stats = { applied: 0, waste: 0, time: 0 };
  var wind = new THREE.Vector3(-1.4, 0, 1.6), windNow = new THREE.Vector3(), simT = 0;
  var hint = { t: 0, flap: false, empty: false, done: false };
  var START = { x: 0, z: 415, psi: 0, hopper: 1200, flap: 1 };
  var rotated = false, SW = 2, SH = 1;
  var v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), q1 = new THREE.Quaternion();

  // ---------- layout: força paisagem mesmo com a tela travada em retrato ----------
  function layout() {
    var w = window.innerWidth, h = window.innerHeight; rotated = h > w * 1.05;
    if (rotated) { SW = h; SH = w; stage.style.transform = 'translateX(' + w + 'px) rotate(90deg)'; }
    else { SW = w; SH = h; stage.style.transform = 'none'; }
    stage.style.width = SW + 'px'; stage.style.height = SH + 'px'; stage.classList.toggle('rot', rotated);
    stage.classList.toggle('short', SH < 330); stage.classList.toggle('narrow', SW < 720);
    renderer.setSize(SW, SH, false); camera.aspect = SW / SH; camera.updateProjectionMatrix();
    sizeTapes();
    spray.mat.uniforms.uScale.value = fire.mat.uniforms.uScale.value = smoke.mat.uniforms.uScale.value = SH * PR / (2 * Math.tan(camera.fov * D2R / 2));
  }
  window.addEventListener('resize', layout); window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });
  function stagePt(e) { return rotated ? { x: e.clientY, y: window.innerWidth - e.clientX } : { x: e.clientX, y: e.clientY }; }
  function stageRect(el) { var x = 0, y = 0, e = el; while (e && e !== stage) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; } return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight }; }

  // ---------- sensor de inclinação ----------
  var tilt = { ok: false, n: 0, last: 0, sx: 0, sy: -1, sz: 0, r0: 0, p0: 0, roll: 0, pitch: 0, buf: [] };
  function screenAngle() {
    var a = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
    else if (typeof window.orientation === 'number') a = window.orientation;
    if (a > 180) a -= 360;
    return rotated ? a + 90 : a;
  }
  function onOri(ev) {
    if (ev.beta == null || ev.gamma == null) return;
    var b = ev.beta * D2R, g = ev.gamma * D2R;
    var dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);   // "para baixo" nos eixos do aparelho
    var a = screenAngle() * D2R, ca = Math.cos(a), sa = Math.sin(a);
    tilt.sx = dx * ca - dy * sa; tilt.sy = dx * sa + dy * ca; tilt.sz = dz;                    // nos eixos da tela
    tilt.n++; tilt.last = performance.now();
    tilt.buf.push([tilt.sx, tilt.sy, tilt.sz]); if (tilt.buf.length > 30) tilt.buf.shift();
  }
  function tiltAngles(sx, sy, sz) { return { r: Math.atan2(sx, -sy), p: Math.atan2(-sz, Math.sqrt(sx * sx + sy * sy)) }; }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function calibrate() {
    var x = 0, y = 0, z = 0, b = tilt.buf.slice(-20);
    if (!b.length) b = [[tilt.sx, tilt.sy, tilt.sz]];
    b.forEach(function (s) { x += s[0]; y += s[1]; z += s[2]; });
    var a = tiltAngles(x, y, z); tilt.r0 = a.r; tilt.p0 = a.p; tilt.roll = 0; tilt.pitch = 0;
  }
  function enableTilt() {
    var start = function () {
      window.addEventListener('deviceorientation', onOri);
      return new Promise(function (res) { setTimeout(function () { res(tilt.n > 0); }, 900); });
    };
    try {
      if (typeof DeviceOrientationEvent === 'undefined') return Promise.resolve(false);
      if (typeof DeviceOrientationEvent.requestPermission === 'function')
        return DeviceOrientationEvent.requestPermission().then(function (r) { return r === 'granted' ? start() : false; }).catch(function () { return false; });
      return start();
    } catch (e) { return Promise.resolve(false); }
  }

  // ---------- entradas na tela ----------
  var joy = { x: 0, y: 0, id: null }, keys = {}, kStick = { x: 0, y: 0 };
  var thrHeld = function () { return false; };
  var P0 = 0.2, lever = P0, reverse = 0, brake = 0;
  function expo(x) { var d = 0.04, a = Math.abs(x); if (a < d) return 0; a = (a - d) / (1 - d); return (x < 0 ? -1 : 1) * Math.pow(Math.min(a, 1), 1.35); }
  // manete: batente de marcha lenta em 20% do curso; abaixo dele é reverso, liberado só no solo
  function setLever(p) {
    p = clamp(p, 0, 1); if (!flight.onGround && p < P0) p = P0; if (Math.abs(p - P0) < 0.035) p = P0;
    lever = p; throttle = p > P0 ? (p - P0) / (1 - P0) : 0; reverse = p < P0 ? (P0 - p) / P0 : 0;
    var k = $('thr-knob'), f = $('thr-fill'); k.style.bottom = (p * 100) + '%'; k.textContent = reverse > 0 ? 'REV' : 'PWR'; k.classList.toggle('rev', reverse > 0);
    f.style.bottom = (Math.min(p, P0) * 100) + '%'; f.style.height = (Math.abs(p - P0) * 100) + '%'; f.classList.toggle('rev', reverse > 0);
  }
  function setThrottle(t) { setLever(P0 + clamp(t, 0, 1) * (1 - P0)); }
  function setFlap(n) { n = clamp(n, 0, 2); if (n !== flight.flap) { flight.flap = n; sfx('flap'); } paintFlap(); }
  function paintFlap() { var k = $('flap-knob'); k.style.top = (flight.flap * 50) + '%'; k.textContent = flight.flap; $('flap').setAttribute('aria-valuenow', flight.flap); }
  function setBrake(on) { brake = on ? 1 : 0; $('b-brake').classList.toggle('on', !!on); }
  (function () {
    var el = $('thr'), id = null; thrHeld = function () { return id !== null; };
    var mv = function (e) { var r = stageRect($('thr-track')), p = stagePt(e); setLever(1 - (p.y - r.y) / r.h); };
    el.addEventListener('pointerdown', function (e) { id = e.pointerId; try { el.setPointerCapture(id); } catch (x) { } mv(e); e.preventDefault(); });
    el.addEventListener('pointermove', function (e) { if (e.pointerId === id) mv(e); });
    var up = function (e) { if (e.pointerId === id) { id = null; if (reverse > 0) setLever(P0); } }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    // alavanca de flape: arrasta ou toca na posição
    var fl = $('flap'), fid = null, fm = function (e) { var r = stageRect($('flap-track')), p = stagePt(e); setFlap(Math.round(clamp((p.y - r.y) / r.h, 0, 1) * 2)); };
    fl.addEventListener('pointerdown', function (e) { fid = e.pointerId; try { fl.setPointerCapture(fid); } catch (x) { } fm(e); e.preventDefault(); });
    fl.addEventListener('pointermove', function (e) { if (e.pointerId === fid) fm(e); });
    var fu = function (e) { if (e.pointerId === fid) fid = null; }; fl.addEventListener('pointerup', fu); fl.addEventListener('pointercancel', fu);
    var hold = function (id, on, off) { var b = $(id), pid = null;
      b.addEventListener('pointerdown', function (e) { pid = e.pointerId; try { b.setPointerCapture(pid); } catch (x) { } on(); b.classList.add('on'); e.preventDefault(); });
      var u = function (e) { if (e.pointerId === pid) { pid = null; off(); b.classList.remove('on'); } }; b.addEventListener('pointerup', u); b.addEventListener('pointercancel', u); };
    hold('b-brake', function () { setBrake(true); }, function () { setBrake(false); });
    var j = $('joy');
    var jm = function (e) { var r = stageRect(j), p = stagePt(e), R = r.w / 2 - 22; joy.x = clamp((p.x - r.x - r.w / 2) / R, -1, 1); joy.y = clamp((p.y - r.y - r.h / 2) / R, -1, 1); var l = Math.sqrt(joy.x * joy.x + joy.y * joy.y); if (l > 1) { joy.x /= l; joy.y /= l; } $('joy-knob').style.transform = 'translate(' + (joy.x * R) + 'px,' + (joy.y * R) + 'px)'; };
    j.addEventListener('pointerdown', function (e) { joy.id = e.pointerId; try { j.setPointerCapture(joy.id); } catch (x) { } jm(e); e.preventDefault(); });
    j.addEventListener('pointermove', function (e) { if (e.pointerId === joy.id) jm(e); });
    var ju = function (e) { if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; $('joy-knob').style.transform = 'translate(0,0)'; } };
    j.addEventListener('pointerup', ju); j.addEventListener('pointercancel', ju);
  })();
  function toggleSpray(on) { var was = spraying; spraying = on === undefined ? !spraying : on; if (flight.hopper <= 0) spraying = false; if (was !== spraying) sfx('valve', spraying); $('b-spray').classList.toggle('on', spraying); $('b-spray').setAttribute('aria-pressed', spraying ? 'true' : 'false'); }
  function cycleCam() { camMode = (camMode + 1) % 2; plane.canopy.visible = camMode === 0; camSnap = true; }
  var tap = function (id, fn) { $(id).addEventListener('click', function (e) { e.preventDefault(); fn(); }); };
  tap('b-spray', function () { toggleSpray(); }); tap('b-cam', cycleCam); tap('b-pause', function () { pause(true); });
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (state !== 'play') return;
    if (e.code === 'Space') { toggleSpray(); e.preventDefault(); }
    if (e.code === 'KeyF') setFlap(flight.flap + 1); if (e.code === 'KeyR') setFlap(flight.flap - 1); if (e.code === 'KeyC') cycleCam(); if (e.code === 'KeyP' || e.code === 'Escape') pause(true);
    if (e.code.indexOf('Arrow') === 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  function readInput(dt) {
    if (keys.KeyW || keys.PageUp) setLever(lever + dt * 0.6); if (keys.KeyS || keys.PageDown) setLever(lever - dt * 0.6);
    if (reverse > 0 && (!flight.onGround || (!thrHeld() && !keys.KeyS && !keys.PageDown))) setLever(P0);       // reverso com mola: solta e volta ao batente
    var kx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), ky = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0), k = Math.min(1, dt * 5);
    kStick.x += (kx - kStick.x) * k; kStick.y += (ky - kStick.y) * k;
    var roll, pitch;
    if (mode === 'tilt') {
      var a = tiltAngles(tilt.sx, tilt.sy, tilt.sz), f = Math.min(1, dt / 0.06);
      tilt.roll += (wrap(a.r - tilt.r0) - tilt.roll) * f; tilt.pitch += ((a.p - tilt.p0) - tilt.pitch) * f;
      var rr = [46, 36, 26][opt.sens] * D2R, pr = [30, 22, 15][opt.sens] * D2R;
      roll = expo(clamp(tilt.roll / rr, -1, 1)); pitch = expo(clamp(-tilt.pitch / pr, -1, 1));
      if (performance.now() - tilt.last > 1500) { mode = 'stick'; applyMode(); say('Sensor parou de responder. Manche na tela ativado.', 5); }
    } else { roll = expo(joy.x); pitch = expo(joy.y); }
    if (opt.invert) pitch = -pitch;
    roll = clamp(roll + kStick.x, -1, 1); pitch = clamp(pitch + kStick.y, -1, 1);
    ctl.throttle = throttle; ctl.reverse = reverse; ctl.brake = Math.max(brake, keys.KeyB ? 1 : 0); ctl.yaw = 0; ctl.roll = roll; ctl.pitch = pitch; ctl.assist = opt.assist;
    ctl.mu = (Math.abs(flight.pos.x) < RWY_HW && Math.abs(flight.pos.z) < RWY_HL) ? 0.045 : 0.09;
  }

  // ---------- som ----------
  var au = null, wasGround = true;
  function initAudio() {
    try {
      if (!au) {
        try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (x) { }   // toca mesmo com a chave de silencioso (iOS 17+)
        var AC_ = window.AudioContext || window.webkitAudioContext; au = makeAudio(new AC_());
      }
      if (au.ctx.state === 'suspended' && au.ctx.resume) au.ctx.resume();
    } catch (e) { au = null; }
  }
  function sfx(name, v) { if (au && opt.sound && state === 'play') { try { au.event(name, v); } catch (e) { } } }
  function updateAudio(active, dt) {
    if (!au) return;
    au.update({ on: active && opt.sound, pow: flight.pow, V: flight.V, vf: flight.vf, onGround: flight.onGround, spraying: spraying && flight.hopper > 0,
      stall: !flight.onGround && !flight.crashed && flight.alpha > AC.aWarn, cockpit: camMode === 1, dt: dt, engineOut: flight.dmg.engine, fire: flight.dmg.fire });
  }

  // ---------- HUD ----------
  var leds = [], LB = 17;
  (function () { var b = $('lb-leds'); for (var i = 0; i < LB; i++) { var d = document.createElement('i'); if (i === (LB - 1) / 2) d.className = 'mid'; b.appendChild(d); leds.push(d); } })();
  var msgT = 0;
  function say(t, sec) { $('msg').textContent = t; show('msg', true); msgT = sec || 4; }
  var fmt = function (n, d) { return n.toFixed(d || 0).replace('.', ','); };
  var hudT = 0, ledOn = -1;
  function guidance() {
    var best = null, bd = 450, px = flight.pos.x, pz = flight.pos.z;
    FIELDS.forEach(function (f) {
      var u = (px - f.cx) * f.ux + (pz - f.cz) * f.uz, w = (px - f.cx) * f.wx + (pz - f.cz) * f.wz;
      var d = Math.max(Math.abs(w) - f.wid / 2, 0) + Math.max(Math.abs(u) - f.len / 2, 0) * 0.35;
      if (d < bd) { bd = d; best = { f: f, u: u, w: w }; }
    });
    return best;
  }
  // ---------- fitas de velocidade e altura (estilo PFD) ----------
  var tpS = $('tp-spd'), tpA = $('tp-alt'), gS = tpS.getContext('2d'), gA = tpA.getContext('2d'), tpW = 66, tpH = 150, altFine = true;
  var INK = '#eef3ea', FNT = '"B612 Mono", ui-monospace, Menlo, monospace';
  function sizeTapes() { tpH = Math.round(clamp(SH * 0.42, 120, 190)); [tpS, tpA].forEach(function (c) { c.style.height = tpH + 'px'; c.width = Math.round(tpW * PR); c.height = Math.round(tpH * PR); }); }
  function drawTape(g, val, o) {
    var Wd = tpW, Hd = tpH, mid = Hd / 2, v, y, k;
    g.setTransform(PR, 0, 0, PR, 0, 0); g.clearRect(0, 0, Wd, Hd);
    g.fillStyle = 'rgba(10,18,14,0.62)'; g.fillRect(0, 0, Wd, Hd);
    for (k = 0; k < o.bands.length; k++) {                        // faixas coloridas na borda dos traços
      var y0 = clamp(mid - (o.bands[k][1] - val) * o.ppu, 0, Hd), y1 = clamp(mid - (o.bands[k][0] - val) * o.ppu, 0, Hd);
      if (y1 > y0) { g.fillStyle = o.bands[k][2]; g.fillRect(o.left ? Wd - 6 : 0, y0, 6, y1 - y0); }
    }
    g.strokeStyle = 'rgba(238,243,234,0.85)'; g.fillStyle = INK; g.lineWidth = 1.4; g.font = '12px ' + FNT; g.textBaseline = 'middle'; g.textAlign = o.left ? 'right' : 'left';
    var span = mid / o.ppu; g.beginPath();
    for (v = Math.ceil((val - span) / o.minor) * o.minor; v <= val + span; v += o.minor) {
      if (v < 0) continue; y = mid - (v - val) * o.ppu; var major = v % o.major === 0, len = major ? 11 : 6;
      if (o.left) { g.moveTo(Wd - 6 - len, y); g.lineTo(Wd - 6, y); } else { g.moveTo(6, y); g.lineTo(6 + len, y); }
      if (major && Math.abs(y - mid) > 22 && y < Hd - 20 && y > 7) g.fillText(v, o.left ? Wd - 21 : 21, y + 0.5);
    }
    g.stroke();
    g.beginPath();                                               // janela do valor atual, com a seta apontando para os traços
    if (o.left) { g.moveTo(2, mid - 16); g.lineTo(Wd - 14, mid - 16); g.lineTo(Wd - 14, mid - 6); g.lineTo(Wd - 6, mid); g.lineTo(Wd - 14, mid + 6); g.lineTo(Wd - 14, mid + 16); g.lineTo(2, mid + 16); }
    else { g.moveTo(Wd - 2, mid - 16); g.lineTo(14, mid - 16); g.lineTo(14, mid - 6); g.lineTo(6, mid); g.lineTo(14, mid + 6); g.lineTo(14, mid + 16); g.lineTo(Wd - 2, mid + 16); }
    g.closePath(); g.fillStyle = '#050807'; g.fill(); g.strokeStyle = o.color || INK; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = o.color || INK; g.font = '700 21px ' + FNT; g.textAlign = 'center'; g.fillText(o.text, o.left ? (Wd - 12) / 2 : (Wd + 12) / 2, mid + 1);
    g.font = '9px ' + FNT; g.fillStyle = '#a9b8ac'; g.fillText(o.label, Wd / 2, Hd - 8);
  }
  function drawTapes() {
    var kt = flight.V * Math.sqrt(RHO / 1.225) * MS2KT, ft = Math.max(0, flight.agl * M2FT);
    var fp = flight.flapPos, clm = 1.72 + (fp <= 1 ? 0.28 * fp : 0.28 + 0.36 * (fp - 1));
    var vs = Math.sqrt(2 * flight.mass() * G / (1.225 * AC.S * clm)) * MS2KT, low = !flight.onGround && kt < vs + 6;
    drawTape(gS, kt, { left: true, ppu: 2.3, minor: 5, major: 10, label: 'KT', text: Math.round(kt), color: low ? '#ff5b4d' : null,
      bands: [[0, vs, '#ff5b4d'], [105, 125, '#7be36a']] });                               // vermelho: abaixo do estol; verde: velocidade de aplicação
    if (altFine && ft > 150) altFine = false; else if (!altFine && ft < 110) altFine = true;
    drawTape(gA, ft, altFine ? { left: false, ppu: 2.6, minor: 5, major: 10, label: 'FT AGL', text: Math.round(ft), bands: [[5, 23, '#7be36a']] }
      : { left: false, ppu: 0.5, minor: 20, major: 100, label: 'FT AGL', text: Math.round(ft / 10) * 10, bands: [[5, 23, '#7be36a']] });   // verde: altura de aplicação
  }

  function updateHud(dt) {
    drawTapes();
    var tick = (hudT -= dt) <= 0; if (tick) hudT = 0.1;
    var g = guidance(), on = -1, cls = '';
    if (g && !flight.onGround) {
      var f = g.f, i = clamp(Math.floor((g.w + f.wid / 2) / SWATH), 0, f.nSw - 1), wc = -f.wid / 2 + (i + 0.5) * SWATH;
      v1.set(1, 0, 0).applyQuaternion(flight.quat);
      var side = (wc - g.w) * (f.wx * v1.x + f.wz * v1.z);
      on = clamp(Math.round((LB - 1) / 2 + side / 1.5), 0, LB - 1);
      var done = f.sw[i] > SWATH * f.len * 0.8; cls = done ? 'done' : (Math.abs(side) < 2 ? 'good' : 'off');
      if (tick) $('lb-txt').textContent = f.name + ' · faixa ' + (i + 1) + '/' + f.nSw + (done ? ' feita' : '') + ' · ' + fmt(Math.abs(side), 1) + ' m';
    } else if (tick) $('lb-txt').textContent = flight.onGround ? 'Guia de faixa' : 'Fora da área';
    if (on !== ledOn || $('lb-leds').className !== cls) { if (ledOn >= 0) leds[ledOn].classList.remove('lit'); if (on >= 0) leds[on].classList.add('lit'); ledOn = on; $('lb-leds').className = cls; }
    if (!tick) return;
    var kt = flight.V * Math.sqrt(RHO / 1.225) * MS2KT, ft = flight.agl * M2FT;
    $('h-hop').textContent = Math.round(flight.hopper); $('hop-fill').style.width = (flight.hopper / START.hopper * 100) + '%';
    $('h-cov').textContent = FIELDS.map(function (f, k) { return 'T' + (k + 1) + ' ' + Math.round(f.cov / f.grid.length * 100) + '%'; }).join(' ');
    var dm = flight.dmg, dl = []; if (dm.gear === 1) dl.push('TREM AVARIADO'); if (dm.gear === 2) dl.push('SEM TREM'); if (dm.wingL) dl.push('ASA E'); if (dm.wingR) dl.push('ASA D'); if (dm.engine) dl.push('MOTOR'); if (dm.fire) dl.push('FOGO'); if (dm.tail) dl.push('CAUDA');
    $('h-dmg').textContent = dl.join(' · ');
    var w = '', wc2 = '';
    if (dm.fire) { w = 'FOGO NO MOTOR'; wc2 = 'bad'; }
    else if (!flight.onGround && flight.alpha > AC.aWarn) { w = 'ESTOL'; wc2 = 'bad'; }
    else if (spraying && flight.agl > 7) { w = 'ALTO DEMAIS · DERIVA'; wc2 = 'warn'; }
    else if (!flight.onGround && flight.agl < 2.2 && flight.vel.y < -0.5) { w = 'SOLO'; wc2 = 'bad'; }
    $('warn').textContent = w; $('warn').className = wc2;
  }

  // ---------- telas ----------
  function applyMode() { $('hud').classList.toggle('stick', mode !== 'tilt'); }
  function resetGame() {
    flight.reset(START); resetFields(); spray.clear(); fire.clear(); smoke.clear(); world.resetWires(); wreckT = 0; stopT = 0;
    debris.forEach(function (d) { scene.remove(d.o); }); debris.length = 0; plane.wings[0].visible = plane.wings[1].visible = true; plane.gearParts.forEach(function (m) { m.visible = true; }); $('h-dmg').textContent = '';
    setThrottle(0); setBrake(false); paintFlap(); toggleSpray(false); camMode = 0; plane.canopy.visible = true; camSnap = true;
    wasGround = true; stats.applied = stats.waste = stats.time = 0; simT = 0; hint.t = 0; hint.flap = hint.empty = hint.done = false; lastX = flight.pos.x; lastZ = flight.pos.z;
  }
  function startPlay() {
    resetGame(); state = 'play'; applyMode();
    ['menu', 'calib', 'pause', 'end'].forEach(function (id) { show(id, false); }); show('hud', true);
    say('Flape 1 armado. Potência total e puxe ao passar de 75 kt.', 6);
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () { }); } catch (e) { }
  }
  function pause(on) {
    if (on && state === 'play') { state = 'pause'; show('pause', true); $('o-recal').classList.toggle('hidden', mode !== 'tilt'); }
    else if (!on && state === 'pause') { state = 'play'; show('pause', false); last = performance.now(); }
  }
  function openCalib(resume) {
    calibResume = resume; state = 'calib'; ['menu', 'pause'].forEach(function (id) { show(id, false); }); show('calib', true);
  }
  var calibResume = false;
  function finish(crash) {
    state = 'end'; show('hud', false); toggleSpray(false);
    var tot = 0, cov = 0, ov = 0, rows = '';
    FIELDS.forEach(function (f) { tot += f.grid.length; cov += f.cov; ov += f.over; rows += '<tr><td>' + f.name + '</td><td>' + fmt(f.cov / f.grid.length * 100, 1) + '%</td><td>' + fmt(f.over / f.grid.length * 100, 1) + '%</td></tr>'; });
    var cp = cov / tot * 100, op = ov / tot * 100, wp = stats.applied > 0 ? stats.waste / stats.applied * 100 : 0;
    var onRwy = Math.abs(flight.pos.x) < RWY_HW && Math.abs(flight.pos.z) < RWY_HL;
    var dm = flight.dmg, dl = [], pen = 0;
    if (dm.gear === 1) { dl.push('trem de pouso avariado'); pen += 10; } if (dm.gear === 2) { dl.push('trem de pouso perdido'); pen += 20; }
    if (dm.wingL) { dl.push('asa esquerda arrancada'); pen += 25; } if (dm.wingR) { dl.push('asa direita arrancada'); pen += 25; }
    if (dm.engine) { dl.push(dm.fire ? 'motor destruído e em chamas' : 'motor parado por toque de hélice'); pen += 20; } if (dm.tail) { dl.push('cauda atingida'); pen += 10; }
    pen = crash ? 40 : Math.min(40, pen); var bad = !!crash || dm.gear === 2 || dm.wingL || dm.wingR || dm.engine;
    var dtxt = dl.length ? dl.join(', ') : ''; if (dtxt) dtxt = dtxt.charAt(0).toUpperCase() + dtxt.slice(1) + '.';
    var score = clamp(Math.round(cp - 0.5 * op - 0.3 * wp - pen + (!bad && onRwy && flight.onGround ? 5 : 0)), 0, 100);
    $('end-title').textContent = crash ? 'Perda total' : (bad ? 'Acidente' : 'Missão encerrada');
    $('end-sub').textContent = crash ? crash + '.' : ((!flight.onGround ? 'Encerrada em voo.' : (bad ? 'O avião parou e você saiu andando.' : (onRwy ? 'Pouso na pista.' : 'Pouso fora da pista.'))) + (dtxt ? ' ' + dtxt : ''));
    $('end-body').innerHTML = '<table><thead><tr><th></th><th>Cobertura</th><th>Sobreposição</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p>Produto aplicado: <b>' + Math.round(stats.applied) + ' L</b> · perdido fora do alvo ou por deriva: <b>' + Math.round(stats.waste) + ' L</b> · tempo: <b>' + Math.floor(stats.time / 60) + ' min ' + Math.round(stats.time % 60) + ' s</b></p>';
    $('end-score').textContent = score;
    $('end').classList.toggle('crash', bad); show('end', true);
  }
  tap('m-tilt', function () {
    initAudio(); $('menu-note').textContent = 'Verificando o sensor…';
    enableTilt().then(function (ok) {
      if (ok) { mode = 'tilt'; $('menu-note').textContent = ''; openCalib(false); }
      else $('menu-note').textContent = 'O sensor de movimento está bloqueado nesta tela. Ele funciona com o jogo aberto direto no Safari, por um endereço https. Aqui, use o manche na tela.';
    });
  });
  tap('m-stick', function () { initAudio(); mode = 'stick'; startPlay(); });
  tap('c-go', function () { calibrate(); show('calib', false); if (calibResume) { state = 'pause'; pause(false); show('hud', true); } else startPlay(); });
  tap('c-back', function () { show('calib', false); if (calibResume) { state = 'pause'; show('pause', true); } else { state = 'menu'; show('menu', true); } });
  tap('p-resume', function () { initAudio(); pause(false); });
  tap('o-recal', function () { openCalib(true); });
  tap('p-restart', function () { startPlay(); });
  tap('p-end', function () { show('pause', false); finish(null); });
  tap('e-again', function () { initAudio(); startPlay(); });
  tap('e-menu', function () { show('end', false); resetGame(); state = 'menu'; show('menu', true); });
  var optBtn = function (id, label, vals, get, set) {
    var el = $(id), paint = function () { el.textContent = label + ': ' + vals[get()]; }; paint();
    el.addEventListener('click', function () { set((get() + 1) % vals.length); paint(); });
  };
  optBtn('o-assist', 'Comando', ['direto (manche)', 'assistido'], function () { return opt.assist ? 1 : 0; }, function (v) { opt.assist = !!v; });
  optBtn('o-sens', 'Sensibilidade', ['baixa', 'média', 'alta'], function () { return opt.sens; }, function (v) { opt.sens = v; });
  optBtn('o-inv', 'Arfagem', ['normal', 'invertida'], function () { return opt.invert ? 1 : 0; }, function (v) { opt.invert = !!v; });
  optBtn('o-snd', 'Som', ['desligado', 'ligado'], function () { return opt.sound ? 1 : 0; }, function (v) { opt.sound = !!v; if (v) initAudio(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(true); });

  // ---------- colisões e dano ----------
  var segs = [[[-7.9, -0.3, -0.3], [7.9, -0.3, -0.3]], [[0, 0, -5.2], [0, 0.2, 4.9]], [[0, 0.3, 4.2], [0, 2.1, 4.6]], [[0, -1.9, -1.3], [0, 0, -1.3]]];
  function hitWires() {
    if (flight.pos.y > 14 || flight.pos.x < 285 || flight.pos.x > 855 || Math.abs(flight.pos.z + 500) > 14) return;
    var dm = flight.dmg;
    for (var s = 0; s < segs.length; s++) {
      if (s === 3 && dm.gear === 2) continue;
      flight.worldPoint(segs[s][0], v1); flight.worldPoint(segs[s][1], v2);
      if (s === 0) { if (dm.wingL) v1.copy(flight.pos); if (dm.wingR) v2.copy(flight.pos); if (dm.wingL && dm.wingR) continue; }
      for (var i = 0; i < world.wires.length; i++) {
        var w = world.wires[i]; if (w.cut || segSegDist2(v1, v2, w.a, w.b) >= 0.2) continue;
        world.cutWire(i); sfx('tear');
        if (s === 0) { v3.set(1, 0, 0).applyQuaternion(flight.quat); var sd = ((w.a.z - flight.pos.z) * v3.z + (w.a.y - flight.pos.y) * v3.y) > 0 ? 1 : -1; if (flight.tearWing(sd)) { flight.r += sd * 0.6; } }
        else if (s === 1) { flight.killEngine(true); }
        else if (s === 2) { if (!dm.tail) { dm.tail = true; flight.events.push('tail'); } }
        else { flight.loseGear(); flight.q -= 0.35; }
        flight.vel.multiplyScalar(0.9); say('Atingiu a rede elétrica.', 4);
      }
    }
  }
  var cpts = [[-7.8, -0.2, 0], [-4, -0.4, 0], [0, 0, -4.5], [0, 0, 0], [4, -0.4, 0], [7.8, -0.2, 0], [0, 0.5, 4.5]];
  function hitObjects() {
    if (flight.pos.y > 24) return;
    var dm = flight.dmg;
    for (var k = 0; k < cpts.length; k++) {
      var ws = k < 2 ? -1 : (k === 4 || k === 5 ? 1 : 0);
      if ((ws < 0 && dm.wingL) || (ws > 0 && dm.wingR)) continue;
      var p = flight.worldPoint(cpts[k], v1), i, t, b;
      for (i = 0; i < world.trees.length; i++) {
        t = world.trees[i]; if (p.y >= t.h) continue;
        var dx = p.x - t.x, dz = p.z - t.z, r = t.pole ? t.r : t.r * 0.85; if (dx * dx + dz * dz >= r * r) continue;
        if (ws) { if (flight.tearWing(ws)) { flight.r += ws * 0.8; flight.vel.multiplyScalar(k === 0 || k === 5 ? 0.9 : 0.8); } break; }       // asa bate: arranca a asa
        if (k === 6) { if (!dm.tail) { dm.tail = true; flight.events.push('tail'); } break; }
        flight.destroy(t.pole ? 'Colidiu com uma estrutura' : 'Colidiu de frente com as árvores'); return;
      }
      for (i = 0; i < world.boxes.length; i++) { b = world.boxes[i]; if (p.y < b.h && p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1) { flight.destroy('Colidiu com uma construção'); return; } }
    }
  }
  function detachWing(side) {
    var wg = plane.wings[side < 0 ? 0 : 1]; if (!wg.visible) return;
    plane.group.updateMatrixWorld(true);
    var o = wg.clone(); wg.getWorldPosition(o.position); wg.getWorldQuaternion(o.quaternion); scene.add(o); wg.visible = false;
    var bv = flight.crashed ? flight.impact.clone().multiplyScalar(0.45).add(v4.set((Math.random() - 0.5) * 8 + side * 5, 0, (Math.random() - 0.5) * 8)) : flight.vel.clone().multiplyScalar(0.75);
    debris.push({ o: o, v: bv.add(v4.set(0, 3 + Math.random() * 3, 0)), w: new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, side * (2 + Math.random() * 3)), rest: false });
  }
  function boom(n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, sp = 3 + Math.random() * 11, px = flight.pos.x + (Math.random() - 0.5) * 4, pz = flight.pos.z + (Math.random() - 0.5) * 4;
      fire.emit(px, flight.pos.y + Math.random() * 2, pz, Math.cos(a) * sp, 2 + Math.random() * 10, Math.sin(a) * sp, 0.5 + Math.random() * 0.7, 3.5, 1);
      if (i % 2 === 0) smoke.emit(px, flight.pos.y + 1, pz, Math.cos(a) * sp * 0.5, 3 + Math.random() * 5, Math.sin(a) * sp * 0.5, 2.5 + Math.random() * 2, 3, 11);
    }
  }
  function onEvent(ev) {
    var dm = flight.dmg;
    if (ev === 'touch') sfx('touch', flight.lastSink);
    else if (ev === 'bounce') { sfx('touch', flight.lastSink + 1); say('Quicou. Segure a atitude e deixe o avião assentar.', 3); }
    else if (ev === 'gearDamage') { sfx('crunch'); say('Pouso duro: trem de pouso avariado. O próximo toque forte derruba o trem.', 6); }
    else if (ev === 'gearCollapse') { sfx('crunch'); plane.gearParts.forEach(function (m) { m.visible = false; }); say('O trem de pouso cedeu.', 5); }
    else if (ev === 'slide') { sfx('crunch'); toggleSpray(false); }
    else if (ev === 'wingL' || ev === 'wingR') { sfx('tear'); detachWing(ev === 'wingL' ? -1 : 1); say(ev === 'wingL' ? 'Asa esquerda arrancada.' : 'Asa direita arrancada.', 5); }
    else if (ev === 'engine') { sfx('bang'); if (reverse > 0 || throttle > 0) { /* manete continua onde está; o motor não responde */ } say(dm.fire ? 'Motor destruído e em chamas.' : 'Hélice tocou o solo: motor parado.', 5); }
    else if (ev === 'tail') { sfx('tear'); say('Cauda atingida: sem leme.', 5); }
    else if (ev === 'destroyed') {                               // perda total: o avião se parte
      var sp = flight.impact.length(), both = sp > 30 || /árvores|estrutura|construção|nariz|violento|Capotou|capotou/.test(flight.crashed || '');
      if (both || flight.phi < -0.1) { dm.wingL = true; detachWing(-1); } if (both || flight.phi > 0.1) { dm.wingR = true; detachWing(1); }
      plane.gearParts.forEach(function (m) { m.visible = false; });
      sfx('crash'); toggleSpray(false); boom(110);
    }
  }

  // ---------- simulação por quadro ----------
  var lastX = 0, lastZ = 0, H = 1 / 120, acc = 0, sinkWas = 0, stopT = 0;
  function simulate(dt) {
    readInput(dt);
    simT += dt; stats.time += flight.hasFlown || !flight.onGround ? dt : 0;
    windNow.set(wind.x + Math.sin(simT * 0.7) * 0.5 + Math.sin(simT * 2.3) * 0.25, 0, wind.z + Math.cos(simT * 0.9) * 0.5 + Math.sin(simT * 3.1) * 0.25);
    acc += dt; var n = 0;
    while (acc >= H && n < 8) { flight.step(H, ctl, windNow); if (!flight.crashed && !flight.onGround) hitWires(); acc -= H; n++; }
    if (n === 8) acc = 0;
    if (!flight.crashed && (!flight.onGround || Math.abs(flight.vf) > 3)) hitObjects();
    while (flight.events.length) onEvent(flight.events.shift());
    if (flight.onGround !== wasGround) { if (!flight.onGround) sfx('lift'); wasGround = flight.onGround; }
    if (flight.crashed) { wreckT += dt; if (wreckT > 3.2) finish(flight.crashed); return; }
    // aplicação
    if (spraying && flight.hopper > 0) {
      var gs = Math.sqrt(flight.vel.x * flight.vel.x + flight.vel.z * flight.vel.z);
      var lit = Math.min(flight.hopper, RATE_L_HA * SWATH * Math.max(gs, 20) / 10000 * dt);
      flight.hopper -= lit; stats.applied += lit;
      spray.emit(flight, 9);
      var frac = 0;
      if (!flight.onGround && flight.agl <= 7) {
        v1.set(1, 0, 0).applyQuaternion(flight.quat); var rl = Math.sqrt(v1.x * v1.x + v1.z * v1.z) || 1;
        frac = applySwath(lastX, lastZ, flight.pos.x, flight.pos.z, v1.x / rl, v1.z / rl, simT);
      }
      stats.waste += lit * (1 - frac);
      if (flight.hopper <= 0) { toggleSpray(false); if (!hint.empty) { hint.empty = true; say('Hopper vazio. Volte para a pista e pouse.', 6); } }
    }
    lastX = flight.pos.x; lastZ = flight.pos.z;
    FIELDS.forEach(function (f) { if (f.dirty && Math.floor(simT * 20) !== Math.floor((simT - dt) * 20)) { f.tex.needsUpdate = true; f.dirty = false; } });
    // dicas
    if (!hint.flap && !flight.onGround && flight.flap > 0 && flight.agl > 15 && flight.V * MS2KT > 92) { hint.flap = true; say('Recolha o flape. Desça para 10 ft sobre o talhão e ligue a aplicação.', 7); }
    if (!hint.done && FIELDS.every(function (f) { return f.cov / f.grid.length > 0.95; })) { hint.done = true; say('Talhões concluídos. Volte para a pista e pouse.', 7); }
    if (flight.hasFlown && flight.onGround && Math.abs(flight.vf) < 0.3 && (lever === P0 || flight.belly || flight.dmg.engine)) { stopT += dt; if (stopT > (flight.belly ? 2.5 : 1.2)) finish(null); } else stopT = 0;
  }

  // ---------- câmera e visual ----------
  var camPos = new THREE.Vector3(), camHead = new THREE.Vector3(0, 0, -1), camSnap = true, flapVis = 0, menuA = 0.6;
  function updateVisual(dt) {
    var g = plane.group; g.position.copy(flight.pos); g.quaternion.copy(flight.quat);
    if (flight.dmg.engine) { plane.prop.material.opacity = 0.95; plane.blur.material.opacity = 0; }
    else { plane.prop.rotation.z -= (6 + flight.pow * 40) * dt; plane.prop.material.opacity = 0.55 - flight.pow * 0.3; plane.blur.material.opacity = 0.06 + flight.pow * 0.12; }
    // fogo e fumaça saem do nariz; no destroço, de toda a fuselagem
    if (flight.dmg.fire && state !== 'menu' && state !== 'calib' && state !== 'pause') {
      var wreck = !!flight.crashed, nf = wreck ? 6 : 3;
      for (var fi = 0; fi < nf; fi++) {
        v1.set((Math.random() - 0.5) * (wreck ? 5 : 0.8), 0.2 + Math.random() * 0.5, wreck ? (Math.random() - 0.5) * 7 : -3.6 + Math.random()).applyQuaternion(flight.quat).add(flight.pos);
        fire.emit(v1.x, v1.y, v1.z, flight.vel.x * 0.5 + (Math.random() - 0.5) * 2, 1 + Math.random() * 3, flight.vel.z * 0.5 + (Math.random() - 0.5) * 2, 0.35 + Math.random() * 0.35, wreck ? 2.6 : 1.5, 0.4);
        if (fi % 2 === 0) smoke.emit(v1.x, v1.y + 0.4, v1.z, flight.vel.x * 0.25 + (Math.random() - 0.5) * 1.5, 1.5, flight.vel.z * 0.25 + (Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 2, 1.4, wreck ? 9 : 6);
      }
    }
    if (state !== 'pause') { fire.update(dt); smoke.update(dt);
      debris.forEach(function (d) { if (d.rest) return; d.v.y -= 9.81 * dt; d.v.multiplyScalar(Math.max(0, 1 - 0.5 * dt)); d.o.position.addScaledVector(d.v, dt);
        d.o.rotateX(d.w.x * dt); d.o.rotateY(d.w.y * dt); d.o.rotateZ(d.w.z * dt);
        if (d.o.position.y < 0.5) { d.o.position.y = 0.5; if (Math.abs(d.v.y) < 2.5 && d.v.lengthSq() < 30) d.rest = true; else { d.v.y = Math.abs(d.v.y) * 0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.5); } } }); }
    flapVis = flight.flapPos <= 1 ? flight.flapPos * 0.2 : 0.2 + (flight.flapPos - 1) * 0.25;
    plane.flaps[0].rotation.x = plane.flaps[1].rotation.x = flapVis;
    plane.ail[0].rotation.x = flight.da * 0.3; plane.ail[1].rotation.x = -flight.da * 0.3;       // esquerda desce para rolar à direita
    plane.elev.rotation.x = -flight.de * 0.35;
    spray.update(dt);
    world.sock.rotation.y = Math.atan2(windNow.x, windNow.z); world.sock.rotation.x = 0.25;
    // sombra acompanha o avião
    world.sun.position.copy(flight.pos).addScaledVector(SUN, 80); world.sun.target.position.copy(flight.pos); world.sun.target.updateMatrixWorld();
    if (state === 'menu' || state === 'calib') {
      menuA += dt * 0.12; camera.position.set(flight.pos.x + Math.sin(menuA) * 19, 4.2, flight.pos.z + Math.cos(menuA) * 19); camera.up.set(0, 1, 0); camera.lookAt(flight.pos.x, flight.pos.y + 0.6, flight.pos.z);
    } else if (flight.crashed) {                                   // destroço: câmera gira em volta
      menuA += dt * 0.22; v2.set(flight.pos.x + Math.sin(menuA) * 26, Math.max(flight.pos.y + 7, 7), flight.pos.z + Math.cos(menuA) * 26);
      camPos.lerp(v2, 1 - Math.exp(-dt * 2.5)); camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(flight.pos.x, flight.pos.y + 1.5, flight.pos.z);
    } else if (camMode === 1) {
      camera.position.set(0, 1.28, 1.15).applyQuaternion(flight.quat).add(flight.pos);
      camera.quaternion.copy(flight.quat).multiply(q1.setFromAxisAngle(v1.set(1, 0, 0), -5 * D2R));
    } else {
      v1.set(0, 0, -1).applyQuaternion(flight.quat); v1.y = 0; if (v1.lengthSq() < 1e-4) v1.copy(camHead); v1.normalize();
      camHead.lerp(v1, camSnap ? 1 : 1 - Math.exp(-dt * 4)).normalize();
      v2.copy(flight.pos).addScaledVector(camHead, -17.5); v2.y += 4.6 - flight.gamma * 5;
      camPos.lerp(v2, camSnap ? 1 : 1 - Math.exp(-dt * 9)); if (camPos.y < 1.4) camPos.y = 1.4;
      camera.position.copy(camPos); camera.up.set(0, 1, 0);
      v3.copy(flight.pos).addScaledVector(camHead, 14); v3.y += 1.2; camera.lookAt(v3); camera.rotateZ(-flight.phi * 0.28);
      camSnap = false;
    }
    var fov = (camMode === 1 ? 72 : 60) + Math.min(10, flight.V * 0.1); if (Math.abs(fov - camera.fov) > 0.2) { camera.fov = fov; camera.updateProjectionMatrix(); }
    world.sky.position.copy(camera.position); world.sky.material.uniforms.time.value += dt;
  }

  var last = performance.now();
  function frame(t) {
    var dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000)); last = t;
    if (state === 'play') { simulate(dt); if (state === 'play') updateHud(dt); }
    if (state === 'calib') {
      var a = tiltAngles(tilt.sx, tilt.sy, tilt.sz);
      $('c-dot').style.transform = 'translate(' + clamp(a.r / 0.7, -1, 1) * 40 + 'px,' + clamp((a.p - 0.8) / 0.8, -1, 1) * 40 + 'px)';
    }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) show('msg', false); }
    updateVisual(dt); updateAudio(state === 'play', dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  layout(); resetGame(); requestAnimationFrame(frame);
  window.__game = { tilt: tilt, ctl: ctl, get mode() { return mode; }, flight: flight, get state() { return state; }, setThrottle: setThrottle, setLever: setLever, debris: debris, setFlap: setFlap, opt: opt, fields: FIELDS, stats: stats };
})();
