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
  var opt = { assist: true, sens: 1, invert: false, sound: true, gfx: 0 };
  try { if (localStorage.getItem('voo-agricola.gfx') === '1') opt.gfx = 1; } catch (e) { }
  var ctl = { throttle: 0, reverse: 0, brake: 0, yaw: 0, pitch: 0, roll: 0, assist: true, mu: 0.045 };
  var stats = { applied: 0, waste: 0, time: 0 };
  var wind = new THREE.Vector3(-1.4, 0, 1.6), windNow = new THREE.Vector3(), simT = 0;
  var hint = { t: 0, flap: false, empty: false, done: false };
  var START = { x: 0, z: 415, psi: 0, hopper: 1200, flap: 1 }, mission = FIELDS[0], free = false, nextM = null, tutor = function () { return !free && mission === FIELDS[0]; };
  var missionHa = function (f) { return f.len * f.wid / 10000; }, missionLoad = function (f) { return Math.min(1890, Math.ceil(missionHa(f) * f.rate * 1.06 / 50) * 50); };
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
    sizeTapes(); tpKey = ''; sizeMini();
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
  var P0 = 0.2, lever = P0, reverse = 0, brake = 0, rud = { bar: 0, id: null, l: 0, r: 0, val: 0, auto: null, px: 99 };
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
    // pedais: no solo dirigem o avião (toque = curso total, barra = proporcional); em voo ficam no automático
    var rb = $('rud-bar'), rm = function (e) { var r = stageRect(rb), p = stagePt(e); rud.bar = clamp((p.x - r.x - r.w / 2) / (r.w / 2 - 20), -1, 1); };
    rb.addEventListener('pointerdown', function (e) { rud.id = e.pointerId; try { rb.setPointerCapture(rud.id); } catch (x) { } rm(e); e.preventDefault(); });
    rb.addEventListener('pointermove', function (e) { if (e.pointerId === rud.id) rm(e); });
    var ru = function (e) { if (e.pointerId === rud.id) { rud.id = null; rud.bar = 0; } }; rb.addEventListener('pointerup', ru); rb.addEventListener('pointercancel', ru);
    hold('ped-l', function () { rud.l = 1; }, function () { rud.l = 0; }); hold('ped-r', function () { rud.r = 1; }, function () { rud.r = 0; });
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
    var air = !flight.onGround, rt = air ? clamp(flight.dr * 2.2, -1, 1) : clamp(rud.bar + rud.r - rud.l + (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0), -1, 1);
    rud.val += (rt - rud.val) * Math.min(1, dt * (air ? 5 : 7));
    if (rud.auto !== air) { rud.auto = air; $('rud').classList.toggle('auto', air); }
    var rpx = Math.round(rud.val * 50); if (rpx !== rud.px) { rud.px = rpx; $('rud-knob').style.transform = 'translateX(' + (rpx * 2) + '%)'; }
    var kx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), ky = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0), k = Math.min(1, dt * 5);
    kStick.x += (kx - kStick.x) * k; kStick.y += (ky - kStick.y) * k;
    var roll, pitch;
    if (mode === 'tilt') {
      var a = tiltAngles(tilt.sx, tilt.sy, tilt.sz), f = Math.min(1, dt / 0.06);
      tilt.roll += (wrap(a.r - tilt.r0) - tilt.roll) * f; tilt.pitch += ((a.p - tilt.p0) - tilt.pitch) * f;
      var rr = [38, 28, 20][opt.sens] * D2R, pr = [30, 22, 15][opt.sens] * D2R;
      roll = expo(clamp(tilt.roll / rr, -1, 1)); pitch = expo(clamp(-tilt.pitch / pr, -1, 1));
      if (performance.now() - tilt.last > 1500) { mode = 'stick'; applyMode(); say('Sensor parou de responder. Manche na tela ativado.', 5); }
    } else { roll = expo(joy.x); pitch = expo(joy.y); }
    if (opt.invert) pitch = -pitch;
    roll = clamp(roll + kStick.x, -1, 1); pitch = clamp(pitch + kStick.y, -1, 1);
    ctl.throttle = throttle; ctl.reverse = reverse; ctl.brake = Math.max(brake, keys.KeyB ? 1 : 0); ctl.yaw = flight.onGround ? rud.val : 0; ctl.roll = roll; ctl.pitch = pitch; ctl.assist = opt.assist;
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
  var auT = 0;
  function updateAudio(active, dt) {
    if (!au) return;
    auT -= dt; if (auT > 0) return; auT = 0.05; dt = 0.05;
    au.update({ on: active && opt.sound, pow: flight.pow, V: flight.V, vf: flight.vf, onGround: flight.onGround, spraying: spraying && flight.hopper > 0,
      stall: !flight.onGround && !flight.crashed && flight.alpha > AC.aWarn, cockpit: camMode === 1, dt: dt, engineOut: flight.dmg.engine, fire: flight.dmg.fire });
  }

  // ---------- HUD ----------
  var leds = [], LB = 17;
  (function () { var b = $('lb-leds'); for (var i = 0; i < LB; i++) { var d = document.createElement('i'); if (i === (LB - 1) / 2) d.className = 'mid'; b.appendChild(d); leds.push(d); } })();
  var msgT = 0;
  function say(t, sec) { $('msg').textContent = t; show('msg', true); msgT = sec || 4; }
  // ---------- Naldinho: instrutor da primeira missão, fala em caixa de diálogo ----------
  var talkQ = [], talkT = 0, said = {};
  var bossSaid = {}, wasteT = 0, wasteSaid = -99, rich = 0, RICH = [1000, 2500, 5000, 10000, 20000];
  function talk(text, key, now, delay) { if (!tutor()) return; if (key) { if (said[key]) return; said[key] = 1; } if (now) { talkQ.length = 0; talkT = 0; } talkQ.push({ t: text, at: simT + (delay || 0), who: 'nal' }); }
  // Seu Eliseu, o patrão: comenta o serviço na missão e no voo livre. Humores: feliz, bravo, maroto.
  function boss(text, mood, key, now, gap) {                     // sem chave: cada frase tem o seu intervalo mínimo
    if (key) { if (said[key]) return; said[key] = 1; } else { if (simT - (bossSaid[text] || -99) < (gap === undefined ? 14 : gap)) return; bossSaid[text] = simT; }
    if (now) { talkQ.length = 0; if (talkT > 0) talkT = 0.01; } talkQ.push({ t: text, at: simT, who: mood });
  }
  function updateTalk(dt) {
    if (talkT > 0) { talkT -= dt; if (talkT <= 0) { show('nal', false); $('hud').classList.remove('talk'); talkT = talkQ.length ? -0.35 : 0; } }
    else if (talkT < 0) { talkT = Math.min(0, talkT + dt); }
    if (talkT === 0 && talkQ.length && talkQ[0].at <= simT) { var it = talkQ.shift(), t = it.t, uri = FACES[it.who]; $('nal-t').textContent = t;
      if (uri) { $('nal-img').src = uri; $('nal-pic').classList.add('has'); } else { $('nal-pic').classList.remove('has'); $('nal-pic').lastChild.textContent = it.who === 'nal' ? 'N' : 'E'; } $('nal').className = it.who === 'nal' ? '' : 'boss ' + it.who; show('msg', false); msgT = 0; show('nal', true); $('hud').classList.add('talk'); talkT = clamp(2.0 + t.length * 0.05, 3, 4.8); sfx('valve', 1); }
  }
  $('nal').addEventListener('click', function () { if (talkT > 0.2) talkT = 0.05; });
  function ref() { if (!free) return mission; var b = FIELDS[0], bd = 1e9; FIELDS.forEach(function (f) { var d = fieldDist(f); if (d < bd) { bd = d; b = f; } }); return b; }
  var fmt = function (n, d) { return n.toFixed(d || 0).replace('.', ','); };
  var hudT = 0, ledOn = -1;
  function guidance() {
    var best = null, bd = 450, px = flight.pos.x, pz = flight.pos.z;
    ACTIVE.forEach(function (f) {
      var u = (px - f.cx) * f.ux + (pz - f.cz) * f.uz, w = (px - f.cx) * f.wx + (pz - f.cz) * f.wz;
      var d = Math.max(Math.abs(w) - f.wid / 2, 0) + Math.max(Math.abs(u) - f.len / 2, 0) * 0.35;
      if (d < bd) { bd = d; best = { f: f, u: u, w: w }; }
    });
    return best;
  }
  // ---------- fitas de velocidade e altura (estilo PFD) ----------
  var tpS = $('tp-spd'), tpA = $('tp-alt'), gS = tpS.getContext('2d'), gA = tpA.getContext('2d'), tpW = 66, tpH = 150, altFine = true;
  var INK = '#eef3ea', FNT = '"B612 Mono", ui-monospace, Menlo, monospace';
  function sizeTapes() { tpH = Math.round(clamp(SH * 0.42, 120, 190)); $('vsi').style.top = 'calc(var(--st) + ' + (tpH + 4) + 'px)'; [tpS, tpA].forEach(function (c) { c.style.height = tpH + 'px'; c.width = Math.round(tpW * PR); c.height = Math.round(tpH * PR); }); }
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
  var tpKey = '', vsAvg = 0, vsShown = null, vsCls = '';
  function drawTapes(force) {
    var kt = flight.V * Math.sqrt(RHO / 1.225) * MS2KT, ft = Math.max(0, flight.hw * M2FT);
    var key = Math.round(kt * 2) + '|' + Math.round(ft * (altFine ? 2 : 0.4)) + '|' + flight.flap + '|' + Math.round(flight.hopper / 40) + '|' + tpH;
    if (key === tpKey && !force) return; tpKey = key;
    var fp = flight.flapPos, clm = 1.72 + (fp <= 1 ? 0.28 * fp : 0.28 + 0.36 * (fp - 1));
    var vs = Math.sqrt(2 * flight.mass() * G / (1.225 * AC.S * clm)) * MS2KT, low = !flight.onGround && kt < vs + 6;
    drawTape(gS, kt, { left: true, ppu: 2.3, minor: 5, major: 10, label: 'KT', text: Math.round(kt), color: low ? '#ff5b4d' : null,
      bands: [[0, vs, '#ff5b4d'], [105, 125, '#7be36a']] });                               // vermelho: abaixo do estol; verde: velocidade de aplicação
    if (altFine && ft > 150) altFine = false; else if (!altFine && ft < 110) altFine = true;
    drawTape(gA, ft, altFine ? { left: false, ppu: 2.6, minor: 5, major: 10, label: 'FT AGL', text: Math.round(ft), bands: [[21, 65, '#7be36a'], [8, 21, '#f3c010']] }
      : { left: false, ppu: 0.5, minor: 20, major: 100, label: 'FT AGL', text: Math.round(ft / 10) * 10, bands: [[21, 65, '#7be36a'], [8, 21, '#f3c010']] });   // verde: altura que vale; dourado: rasante, paga em dobro
  }

  // ---------- moedas, XP e orientação ----------
  var KEY = 'voo-agricola.v1', wallet = { coins: 0, xp: 0, prog: 0 };
  try { var sv = JSON.parse(localStorage.getItem(KEY) || 'null'); if (sv && typeof sv.coins === 'number') { wallet.coins = sv.coins; wallet.xp = sv.xp || 0; wallet.prog = Math.min(FIELDS.length, sv.prog || (sv.tut ? 1 : 0)); } } catch (e) { }
  var bank = { coins: 0, xp: 0, shown: 0, tick: 0, xpShown: -1 }, rwQ = [], rwT = 0, tgt = null, tgtT = 0, curF = null, lastSw = -1;
  var H_MAX = 20, H_LOW = 6.5, lowNow = false, plan = null;            // aplicação vale até 65 ft; até 21 ft é rasante e paga em dobro
  var COIN_M = 1, TIER = [null, { q: 0.72, c: 40, xp: 1, t: 'Faixa aceitável' }, { q: 0.88, c: 80, xp: 2, t: 'Faixa boa' }, { q: 0.96, c: 150, xp: 5, t: 'Faixa perfeita' }];
  var level = function () { return 1 + Math.floor((wallet.xp + bank.xp) / 40); };
  function award(c, xp, label, tier) { bank.coins += c; bank.xp += xp; rwQ.push({ c: c, xp: xp, t: label, tier: tier || 1 }); }
  function locUW(f) { var px = flight.pos.x - f.cx, pz = flight.pos.z - f.cz; return { u: px * f.ux + pz * f.uz, w: px * f.wx + pz * f.wz }; }
  function swQ(f, i) { return clamp(f.sw[i] / (SWATH * f.len), 0, 1); }
  function evaluate(f) {                                           // fim de uma passagem: paga o bônus das faixas que subiram de categoria
    if (f.passAll > SWATH * 150 && f.passLow / f.passAll >= 0.7) award(60, 1, 'Rasante: abaixo de 20 ft', 2); f.passAll = f.passLow = 0;
    talk('Agora o balão: vai pro lado da seta.', 'balao');
    for (var i = 0; i < f.nSw; i++) {
      var q = swQ(f, i), t = q >= TIER[3].q ? 3 : (q >= TIER[2].q ? 2 : (q >= TIER[1].q ? 1 : 0));
      if (t > f.tier[i]) { if (t === 3) boss('Ó, piloto bão!', 'feliz', null, false, 8); var o = f.tier[i]; award(TIER[t].c - (o ? TIER[o].c : 0), TIER[t].xp - (o ? TIER[o].xp : 0), TIER[t].t + ' · ' + Math.round(q * 100) + '%', t); f.tier[i] = t; }
      else if (f.touched[i] && t === 0 && q > 0.15) { say('Faixa ' + (i + 1) + ' incompleta: ' + Math.round(q * 100) + '%.', 3); boss('Ó, piloto ruim, meu Deuuus!', 'bravo', null, false, 8); }
      f.touched[i] = 0;
    }
    if (!f.done) { for (i = 0; i < f.nSw; i++) if (!f.tier[i]) return;
      f.done = true; var cv = f.cov / f.grid.length;
      var fim = ['Parabéns, piloto! Pousa aqui, vem tomar café da fazenda!', 'Serviço fechado, piloto! O café já tá passado.', 'Aí sim, piloto! Pousa que tem bolo de milho.']; boss(fim[Math.floor(Math.random() * fim.length)], 'feliz', 'fim' + f.name, false);
      if (cv >= 0.95) award(1000, 20, f.name + ' concluído com excelência', 3); else if (cv >= 0.85) award(600, 12, f.name + ' concluído', 2); else award(300, 6, f.name + ' concluído', 1);
    }
  }
  function pickTarget() {
    var f = ACTIVE[0], k, i;
    if (free) { f = ref(); if (f.done || fieldDist(f) > 1500) return null; var l = locUW(f), bi = -1, bc = 1e9; for (i = 0; i < f.nSw; i++) { if (f.tier[i]) continue; var c = Math.abs(l.w + f.wid / 2 - (i + 0.5) * SWATH); if (c < bc) { bc = c; bi = i; } } return bi < 0 ? null : { f: f, i: bi }; }
    if (!f || f.done) return null;
    for (k = 0; k < f.nSw; k++) { i = k % 2 === 0 ? k / 2 : (k - 1) / 2 + f.nSw / 2; if (!f.tier[i]) return { f: f, i: i }; }
    return null;
  }
  function updateGame(dt) {
    var i, f;
    for (i = 0; i < ACTIVE.length; i++) {
      f = ACTIVE[i];
      if (f.fresh) { var gain = COIN_M * (lowNow ? 2 : 1) * f.fresh / SWATH; f.passAll = (f.passAll || 0) + f.fresh; if (lowNow) f.passLow = (f.passLow || 0) + f.fresh; bank.coins += gain; bank.tick += gain; f.fresh = 0; f.evalPending = true; if (bank.tick >= 30) { bank.tick = 0; sfx('coin'); } }
      if (f.evalPending && simT - f.lastHit > 1.0) { f.evalPending = false; evaluate(f); }
    }
    // faixa-alvo: a que está sendo aplicada; fora dela, a pendente mais próxima
    var pass = null;
    if (spraying && !flight.onGround) for (i = 0; i < ACTIVE.length; i++) { f = ACTIVE[i]; var l = locUW(f); if (Math.abs(l.u) < f.len / 2 + 10 && Math.abs(l.w) < f.wid / 2) { talk('Isso! Segura a altura no meio da faixa.', 'spray'); pass = { f: f, i: clamp(Math.floor((l.w + f.wid / 2) / SWATH), 0, f.nSw - 1) }; curF = f; lastSw = pass.i; } }
    tgtT -= dt;
    if (pass) { if (!tgt || tgt.f !== pass.f || tgt.i !== pass.i) { tgt = pass; world.setLane(tgt.f, tgt.i); } tgtT = 1.2; }
    else if (tgtT <= 0) { tgtT = 0.4; var n = pickTarget(); if ((n && (!tgt || n.f !== tgt.f || n.i !== tgt.i)) || (!n && tgt)) { tgt = n; world.setLane(n && n.f, n && n.i); } }
    // recompensas na tela, uma por vez
    if (rwT > 0) { rwT -= dt; if (rwT <= 0) show('reward', false); }
    if (rwT <= 0 && rwQ.length) { var r = rwQ.shift(); $('rw-c').textContent = r.c ? '+' + r.c : ''; $('reward').classList.toggle('plain', !r.c); $('rw-t').textContent = r.t; $('rw-x').textContent = r.xp ? '+' + r.xp + ' XP' : ''; show('msg', false); msgT = 0; show('reward', true); rwT = 1.9; sfx('reward', r.tier); }
    if (Math.abs(bank.coins - bank.shown) > 0.5) { bank.shown += (bank.coins - bank.shown) * Math.min(1, dt * 7); if (Math.abs(bank.coins - bank.shown) < 1) bank.shown = bank.coins; $('h-coin').textContent = Math.floor(bank.shown).toLocaleString('pt-BR'); }
    if (bank.xp !== bank.xpShown) { bank.xpShown = bank.xp; $('h-xp').textContent = 'XP ' + bank.xp + ' · NV ' + level(); }
    if (rich < RICH.length && bank.coins >= RICH[rich]) { rich++; boss('Ó, piloto vai ficar rico!', 'feliz', null, false, 20); }
    if (flight.onGround && !flight.hasFlown && throttle > 0.7 && flight.vf > 10) boss('Piloto, trabalhar, piloto!', 'maroto', 'b_to', true);
    updateFD(dt); updateNav(dt); updateTalk(dt);
  }
  // ---------- pinos, avisos de chegada e minimapa ----------
  var pinF = world.makePin('#7be36a'), pinR = world.makePin('#ffffff'), nav = { at: null, atRwy: false, land: false, bnT: 0, mapT: 0 };
  pinR.setText('PISTA SCHEFFER', 'SAPEZAL - MT'); pinR.position.set(0, 55, 0);
  function banner(t, sub) { $('bn-t').textContent = t; $('bn-s').textContent = sub || ''; show('banner', true); nav.bnT = 3.6; sfx('reward', 2); }
  function fieldDist(f) { var l = locUW(f), a = Math.max(Math.abs(l.u) - f.len / 2, 0), b = Math.max(Math.abs(l.w) - f.wid / 2, 0); return Math.sqrt(a * a + b * b); }
  function updateNav(dt) {
    var f = ref(), air = !flight.onGround, bob = Math.sin(simT * 2) * 5;
    nav.land = flight.hopper <= 0 || flight.dmg.engine || flight.dmg.gear > 0 || (free ? ACTIVE.every(function (x) { return x.done; }) : f.done);
    var df = fieldDist(f), dr = Math.sqrt(flight.pos.x * flight.pos.x + Math.pow(clamp(flight.pos.z, -RWY_HL, RWY_HL) - flight.pos.z, 2));
    // talhão: o pino aparece até chegar; na chegada mostra o nome e some
    if (nav.at !== f && df < 260 && air) { nav.at = f; banner(f.farm, f.name + ' · ' + f.prod + ' · ' + f.nSw + ' faixas'); talk('Desce, alinha na faixa amarela e liga.', 'arrive', false, 3.8); }
    else if (nav.at === f && df > 1300) nav.at = null;
    pinF.visible = state === 'play' && !free && !nav.land && nav.at !== f; if (pinF.visible) pinF.position.set(f.cx, 70 + bob, f.cz);
    // pista: pino quando é hora de voltar
    if (nav.land && !nav.atRwy && dr < 420 && air) { nav.atRwy = true; banner('Pista Scheffer', 'Sapezal - MT · pouse e pare na pista'); talk('Flape 2, 70 nós e pouso macio.', 'final', false, 3.8); }
    else if (nav.atRwy && dr > 1300) nav.atRwy = false;
    pinR.visible = state === 'play' && nav.land && !nav.atRwy && air; if (pinR.visible) pinR.position.y = 55 + bob;
    if (nav.bnT > 0) { nav.bnT -= dt; if (nav.bnT <= 0) show('banner', false); }
    nav.mapT -= dt; if (nav.mapT <= 0) { nav.mapT = 0.1; drawMini(); }
  }
  var mini = $('mini'), gM = mini.getContext('2d'), mSize = 92;
  function drawMini() {                                            // proa para cima; 1.600 m de raio
    var S = mSize, c = S / 2, k = c / 1600, sp = Math.sin(flight.psi), cp = Math.cos(flight.psi), f, g = gM, i, fi;
    var X = function (x, z) { var dx = x - flight.pos.x, dz = z - flight.pos.z; return c + (dx * cp + dz * sp) * k; }, Y = function (x, z) { var dx = x - flight.pos.x, dz = z - flight.pos.z; return c - (dx * sp - dz * cp) * k; };
    g.setTransform(PR, 0, 0, PR, 0, 0); g.clearRect(0, 0, S, S); g.save(); g.beginPath(); g.arc(c, c, c - 1, 0, 6.3); g.clip();
    g.strokeStyle = 'rgba(238,243,234,0.18)'; g.lineWidth = 1; g.beginPath(); g.arc(c, c, c / 2, 0, 6.3); g.stroke();
    var P = function (u, w) { return [f.cx + f.ux * u + f.wx * w, f.cz + f.uz * u + f.wz * w]; }, cs;
    for (fi = 0; fi < ACTIVE.length; fi++) { f = ACTIVE[fi]; cs = [P(-f.len / 2, -f.wid / 2), P(-f.len / 2, f.wid / 2), P(f.len / 2, f.wid / 2), P(f.len / 2, -f.wid / 2)];
    g.beginPath(); for (i = 0; i < 4; i++) g[i ? 'lineTo' : 'moveTo'](X(cs[i][0], cs[i][1]), Y(cs[i][0], cs[i][1])); g.closePath(); g.fillStyle = f.done ? 'rgba(123,227,106,0.25)' : 'rgba(243,192,16,0.30)'; g.fill(); g.strokeStyle = f.done ? '#7be36a' : '#f3c010'; g.lineWidth = 1.5; g.stroke(); }
    if (tgt) { f = tgt.f; var wc = -f.wid / 2 + (tgt.i + 0.5) * SWATH, a = P(-f.len / 2, wc), b = P(f.len / 2, wc); g.beginPath(); g.moveTo(X(a[0], a[1]), Y(a[0], a[1])); g.lineTo(X(b[0], b[1]), Y(b[0], b[1])); g.strokeStyle = '#fff6c0'; g.lineWidth = 1.5; g.stroke(); }
    g.beginPath(); g.moveTo(X(0, -RWY_HL), Y(0, -RWY_HL)); g.lineTo(X(0, RWY_HL), Y(0, RWY_HL)); g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.stroke();
    g.restore();
    // fora do alcance: ponto na borda, na direção certa
    var rim = function (x, z, col) { var mx = X(x, z) - c, my = Y(x, z) - c, d = Math.sqrt(mx * mx + my * my); if (d < c - 4) return; g.beginPath(); g.arc(c + mx / d * (c - 4), c + my / d * (c - 4), 4, 0, 6.3); g.fillStyle = col; g.fill(); };
    ACTIVE.forEach(function (x) { rim(x.cx, x.cz, x.done ? '#7be36a' : '#f3c010'); }); rim(0, 0, '#ffffff');
    g.beginPath(); g.moveTo(c, c - 7); g.lineTo(c + 5, c + 5); g.lineTo(c, c + 2); g.lineTo(c - 5, c + 5); g.closePath(); g.fillStyle = '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 1; g.fill(); g.stroke();
    var nx = c + -sp * (c - 9), ny = c - cp * (c - 9); g.font = '700 9px ' + FNT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ff8a7a'; g.fillText('N', nx, ny);
  }
  function sizeMini() { mSize = SH < 330 ? 80 : 92; mini.width = Math.round(mSize * PR); mini.height = Math.round(mSize * PR); }

  // arco de direção: a seta mostra para onde virar para chegar à cabeceira da faixa-alvo (ou à pista, no fim)
  var fd = { a: 0, px: 999, text: '', cls: '', vis: false };
  function updateFD(dt) {
    var on = !flight.onGround && !flight.crashed;
    if (on !== fd.vis) { fd.vis = on; show('fd', on); } if (!on) return;
    var fx = Math.sin(flight.psi), fz = -Math.cos(flight.psi), ax, az, dist, label;
    if (tgt && !(flight.hopper <= 0 || flight.dmg.engine)) {
      var f = tgt.f, l = locUW(f), wc = -f.wid / 2 + (tgt.i + 0.5) * SWATH, hx = fx * f.ux + fz * f.uz, au, E;
      if (Math.abs(l.u) < f.len / 2 + 20 && Math.abs(l.w - wc) < SWATH * 0.9 && Math.abs(hx) > 0.8) { au = l.u + (hx > 0 ? 170 : -170); dist = f.len / 2 - l.u * (hx > 0 ? 1 : -1); label = 'FAIXA ' + (tgt.i + 1) + ' · FIM EM '; }
      else {
        E = Math.abs(l.u) > f.len / 2 ? (l.u > 0 ? 1 : -1) : (hx >= 0 ? 1 : -1);
        var ext = Math.abs(l.u) - f.len / 2, aligned = Math.abs(l.w - wc) < 60 && hx * E < -0.5 && ext > 0, aw = wc;
        var du = E * f.len / 2 - l.u, dw = wc - l.w; dist = Math.sqrt(du * du + dw * dw); label = 'FAIXA ' + (tgt.i + 1) + ' · ';
        if (ext > -40 && hx * E > 0.2) {                             // afastando-se da cabeceira: fase de saída do balão
          if (!plan || plan.i !== tgt.i || plan.E !== E) { var Dm = 205 + 0.06 * flight.hopper, sg = dw >= 0 ? 1 : -1; plan = { i: tgt.i, E: E, wPre: Math.abs(dw) >= Dm ? l.w : wc - sg * Dm }; plan.x = 150 + 1.3 * Math.abs(plan.wPre - l.w); }
          if ((ext < plan.x && Math.abs(l.w - plan.wPre) > 22) || ext < 130) { au = E * (f.len / 2 + Math.max(ext, 0) + 170); aw = plan.wPre; label = (Math.abs(l.w - plan.wPre) > 22 ? 'ABRA · ' : 'SIGA · ') + 'FAIXA ' + (tgt.i + 1) + ' · '; }
          else { au = E * (f.len / 2 + Math.max(ext - 70, 120)); label = 'CURVA · FAIXA ' + (tgt.i + 1) + ' · '; }
        } else { plan = null; au = E * (f.len / 2 + (aligned ? clamp(ext - 100, 0, 380) : (ext > 0 ? clamp(ext - 60, 160, 380) : 380))); }
      }
      ax = f.cx + f.ux * au + f.wx * (aw === undefined ? wc : aw); az = f.cz + f.uz * au + f.wz * (aw === undefined ? wc : aw);
    } else {
      var Ez = flight.pos.z >= 0 ? 1 : -1, al = Math.abs(flight.pos.x) < 50 && fz * Ez < -0.5 && Math.abs(flight.pos.z) > RWY_HL;
      ax = 0; az = Ez * (RWY_HL + (al ? clamp(Math.abs(flight.pos.z) - RWY_HL - 150, -200, 500) : 500)); dist = Math.sqrt(flight.pos.x * flight.pos.x + Math.pow(Ez * RWY_HL - flight.pos.z, 2)); label = 'PISTA SCHEFFER · ';
    }
    var dx = ax - flight.pos.x, dz = az - flight.pos.z, rel = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    var a = clamp(rel, -Math.PI / 2, Math.PI / 2) * (50 / 90);
    fd.a += (a - fd.a) * Math.min(1, dt * 8);
    var px = Math.round(fd.a * 400);
    if (px !== fd.px) { fd.px = px; $('fd-m').setAttribute('transform', 'translate(' + (120 * Math.sin(fd.a)).toFixed(1) + ',' + (120 - 120 * Math.cos(fd.a)).toFixed(1) + ') rotate(' + (fd.a / D2R).toFixed(1) + ')'); }
    var cls = Math.abs(rel) > Math.PI / 2 ? 'behind' : (Math.abs(rel) < 4 * D2R ? 'on' : '');
    if (cls !== fd.cls) { fd.cls = cls; $('fd').setAttribute('class', cls); }
    fd.text = label + (dist >= 1000 ? fmt(dist / 1000, 1) + ' km' : Math.max(0, Math.round(dist / 10) * 10) + ' m');
  }

  function updateHud(dt) {
    drawTapes();
    var tick = (hudT -= dt) <= 0; if (tick) hudT = 0.1;
    var g = guidance(), on = -1, cls = '';
    if (tgt) { var tl = locUW(tgt.f); g = { f: tgt.f, u: tl.u, w: tl.w }; }
    if (g && !flight.onGround) {
      var f = g.f, i = tgt ? tgt.i : clamp(Math.floor((g.w + f.wid / 2) / SWATH), 0, f.nSw - 1), wc = -f.wid / 2 + (i + 0.5) * SWATH;
      v1.set(1, 0, 0).applyQuaternion(flight.quat);
      var side = (wc - g.w) * (f.wx * v1.x + f.wz * v1.z);
      on = clamp(Math.round((LB - 1) / 2 + side / 1.5), 0, LB - 1);
      var done = f.tier[i] > 0; cls = done ? 'done' : (Math.abs(side) < 2 ? 'good' : 'off');
      if (tick) $('lb-txt').textContent = fd.vis && fd.text ? fd.text : f.name + ' · faixa ' + (i + 1) + '/' + f.nSw;
    } else if (tick) $('lb-txt').textContent = flight.onGround ? ref().farm + ' · ' + ref().name : (fd.vis && fd.text ? fd.text : 'Fora da área');
    if (on !== ledOn || $('lb-leds').className !== cls) { if (ledOn >= 0) leds[ledOn].classList.remove('lit'); if (on >= 0) leds[on].classList.add('lit'); ledOn = on; $('lb-leds').className = cls; }
    if (!tick) return;
    var kt = flight.V * Math.sqrt(RHO / 1.225) * MS2KT, ft = flight.hw * M2FT;
    // razão de subida, arredondada a 50 ft/min; perto do solo as cores seguem os limites do trem
    vsAvg += (flight.vel.y * 196.85 - vsAvg) * 0.5; var vs = flight.onGround ? 0 : Math.round(vsAvg / 50) * 50, low = !flight.onGround && flight.hw < 30 && vs < 0;
    var vcls = (vs > 0 ? 'up' : (vs < 0 ? 'dn' : 'lvl')) + (low && vs <= -670 ? ' bad' : (low && vs <= -370 ? ' warn' : ''));
    if (vs !== vsShown || vcls !== vsCls) { vsShown = vs; vsCls = vcls; $('vsi-v').textContent = Math.abs(vs); $('vsi').className = vcls; }
    $('h-hop').textContent = Math.round(flight.hopper); $('hop-fill').style.width = (flight.hopper / START.hopper * 100) + '%';
    var rf = ref(); $('h-cov').textContent = 'ÁREA ' + Math.round(rf.cov / rf.grid.length * 100) + '%';
    var dm = flight.dmg, dl = []; if (dm.gear === 1) dl.push('TREM AVARIADO'); if (dm.gear === 2) dl.push('SEM TREM'); if (dm.wingL) dl.push('ASA E'); if (dm.wingR) dl.push('ASA D'); if (dm.engine) dl.push('MOTOR'); if (dm.fire) dl.push('FOGO'); if (dm.tail) dl.push('CAUDA');
    $('h-dmg').textContent = dl.join(' · ');
    var w = '', wc2 = '';
    if (dm.fire) { w = 'FOGO NO MOTOR'; wc2 = 'bad'; }
    else if (!flight.onGround && flight.alpha > AC.aWarn) { w = 'ESTOL'; wc2 = 'bad'; }
    else if (spraying && flight.hw > H_MAX) { w = 'ALTO DEMAIS · DESÇA DE 65 FT'; wc2 = 'warn'; }
    else if (!flight.onGround && flight.agl < 2.2 && flight.vel.y < -0.5) { w = 'SOLO'; wc2 = 'bad'; }
    $('warn').textContent = w; $('warn').className = wc2;
  }

  // ---------- telas ----------
  function applyMode() { $('hud').classList.toggle('stick', mode !== 'tilt'); }
  function resetGame() {
    START.hopper = free ? 1890 : missionLoad(mission); flight.reset(START); resetFields(free ? FIELDS : mission); world.markField(free ? null : mission); spray.clear(); fire.clear(); smoke.clear(); world.setObstacles(free ? FIELDS : [mission]); wreckT = 0; stopT = 0;
    debris.forEach(function (d) { scene.remove(d.o); }); debris.length = 0; plane.wings[0].visible = plane.wings[1].visible = true; plane.gearParts.forEach(function (m) { m.visible = true; }); $('h-dmg').textContent = '';
    setThrottle(0); setBrake(false); rud.bar = rud.l = rud.r = rud.val = 0; paintFlap(); toggleSpray(false); camMode = 0; plane.canopy.visible = true; camSnap = true;
    wasGround = true; stats.applied = stats.waste = stats.time = 0; nav.at = null; nav.atRwy = nav.land = false; talkQ.length = 0; talkT = 0; said = {}; bossSaid = {}; wasteT = 0; wasteSaid = -99; rich = 0; show('nal', false); $('hud').classList.remove('talk'); nav.bnT = 0; show('banner', false); pinF.visible = pinR.visible = false; pinF.setText(mission.farm.toUpperCase(), mission.name.toUpperCase()); plan = null; lowNow = false; mission.passAll = mission.passLow = 0; bank.coins = bank.xp = bank.shown = bank.tick = 0; bank.xpShown = -1; rwQ.length = 0; rwT = 0; show('reward', false); tgt = null; tgtT = 0; curF = null; lastSw = -1; world.setLane(null); $('h-coin').textContent = '0'; fd.vis = false; show('fd', false); simT = 0; hint.t = 0; hint.flap = hint.empty = hint.done = false; lastX = flight.pos.x; lastZ = flight.pos.z;
  }
  function startPlay() {
    resetGame(); state = 'play'; applyMode();
    ['menu', 'calib', 'pause', 'end'].forEach(function (id) { show(id, false); }); show('hud', true);
    nextM = null;
    if (free) say('Voo livre. Hopper cheio: todos os talhões aceitam aplicação.', 6);
    else if (!tutor()) boss(mission.brief, 'maroto', 'b_brief');
    else { talk('Fala, comandante! Hoje é o ' + mission.name + ', ' + mission.farm.replace('Fazenda ', '') + '.', 'hello'); talk('Flape 1, manete à frente, puxa com 75 nós.', 'takeoff'); }
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
    state = 'end'; show('hud', false); toggleSpray(false); pinF.visible = pinR.visible = false; show('banner', false);
    var tot = 0, cov = 0, ov = 0, rows = '';
    ACTIVE.forEach(function (f) { if (free && !f.cov) return; tot += f.grid.length; cov += f.cov; ov += f.over; rows += '<tr><td>' + f.farm + ' · ' + f.name + '</td><td>' + fmt(f.cov / f.grid.length * 100, 1) + '%</td><td>' + fmt(f.over / f.grid.length * 100, 1) + '%</td></tr>'; });
    tot = tot || 1; var cp = cov / tot * 100, op = ov / tot * 100, wp = stats.applied > 0 ? stats.waste / stats.applied * 100 : 0;
    var onRwy = Math.abs(flight.pos.x) < RWY_HW && Math.abs(flight.pos.z) < RWY_HL;
    var dm = flight.dmg, dl = [], pen = 0;
    if (dm.gear === 1) { dl.push('trem de pouso avariado'); pen += 10; } if (dm.gear === 2) { dl.push('trem de pouso perdido'); pen += 20; }
    if (dm.wingL) { dl.push('asa esquerda arrancada'); pen += 25; } if (dm.wingR) { dl.push('asa direita arrancada'); pen += 25; }
    if (dm.engine) { dl.push(dm.fire ? 'motor destruído e em chamas' : 'motor parado por toque de hélice'); pen += 20; } if (dm.tail) { dl.push('cauda atingida'); pen += 10; }
    pen = crash ? 40 : Math.min(40, pen); var bad = !!crash || dm.gear === 2 || dm.wingL || dm.wingR || dm.engine;
    var dtxt = dl.length ? dl.join(', ') : ''; if (dtxt) dtxt = dtxt.charAt(0).toUpperCase() + dtxt.slice(1) + '.';
    var score = clamp(Math.round(cp - 0.5 * op - 0.3 * wp - pen + (!bad && onRwy && flight.onGround ? 5 : 0)), 0, 100);
    // fecha a conta da missão: bônus de pouso, custo do conserto, e soma na carteira
    ACTIVE.forEach(function (f) { if (f.evalPending) { f.evalPending = false; evaluate(f); } });
    var notes = [], earned = Math.round(bank.coins);
    if (!bad && !dl.length && onRwy && flight.onGround && flight.hasFlown) { bank.coins += 300; bank.xp += 5; notes.push('Pouso limpo na pista: +300 moedas e +5 XP'); }
    if (crash) { var lost = Math.round(bank.coins * 0.5); bank.coins -= lost; notes.push('Perda total: ' + lost.toLocaleString('pt-BR') + ' moedas ficaram no prejuízo'); }
    else if (dl.length) { var fix = Math.min(Math.round(bank.coins), pen * 15); bank.coins -= fix; notes.push('Conserto: -' + fix.toLocaleString('pt-BR') + ' moedas'); }
    var mc = Math.round(bank.coins), lv0 = 1 + Math.floor(wallet.xp / 40); wallet.coins += mc; wallet.xp += bank.xp; var lv1 = 1 + Math.floor(wallet.xp / 40);
    try { localStorage.setItem(KEY, JSON.stringify(wallet)); } catch (e) { }
    if (lv1 > lv0) notes.push('Subiu para o nível ' + lv1);
    rwQ.length = 0; show('reward', false); show('msg', false);
    $('end-title').textContent = crash ? 'Perda total' : (bad ? 'Acidente' : (free ? 'Voo livre encerrado' : (mission.done ? 'Missão cumprida' : 'Missão encerrada')));
    var nq = '';
    var mi = FIELDS.indexOf(mission); nextM = null;
    if (!free) { if (mission.done && wallet.prog <= mi) { wallet.prog = mi + 1; try { localStorage.setItem(KEY, JSON.stringify(wallet)); } catch (e) { } notes.push(mi === 0 ? 'Missão 2 e voo livre liberados' : (mi + 1 < FIELDS.length ? 'Missão ' + (mi + 2) + ' liberada' : 'Todas as missões cumpridas')); }
      if (mission.done && !crash && mi + 1 < FIELDS.length) nextM = FIELDS[mi + 1];
      if (mi > 0) nq = crash ? 'Seu Eliseu: “Ó, piloto ruim, meu Deuuus!”' : (mission.done ? (bad ? 'Seu Eliseu: “Ê, piloto, vai me falir!”' : 'Seu Eliseu: “Ó, piloto bão! Vem tomar café da fazenda.”') : 'Seu Eliseu: “Ficou faixa sem fazer, piloto!”');
      else nq = crash ? 'Naldinho: “Avião a gente conserta. Bora de novo.”' : (mission.done ? (bad ? 'Naldinho: “Talhão pronto, mas capricha no pouso.”' : 'Naldinho: “Missão cumprida! Agora é com o Seu Eliseu.”') : 'Naldinho: “Ficou faixa sem fazer. Fecha o talhão.”'); }
    if (free) nq = crash ? 'Seu Eliseu: “Ó, piloto ruim, meu Deuuus!”' : (bad ? 'Seu Eliseu: “Ê, piloto, vai me falir!”' : (mc >= 1000 ? 'Seu Eliseu: “Ó, piloto bão! Vem tomar café da fazenda.”' : ''));
    $('end-nal').textContent = nq; show('end-nal', !!nq);
    $('end-sub').textContent = crash ? crash + '.' : ((!flight.onGround ? 'Encerrada em voo.' : (bad ? 'O avião parou e você saiu andando.' : (onRwy ? 'Pouso na pista.' : 'Pouso fora da pista.'))) + (dtxt ? ' ' + dtxt : ''));
    $('end-body').innerHTML = '<table><thead><tr><th></th><th>Cobertura</th><th>Sobreposição</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p>Produto aplicado: <b>' + Math.round(stats.applied) + ' L</b> · perdido fora do alvo ou por deriva: <b>' + Math.round(stats.waste) + ' L</b> · tempo: <b>' + Math.floor(stats.time / 60) + ' min ' + Math.round(stats.time % 60) + ' s</b></p>' +
      '<p class="money"><i class="coin"></i><b>' + mc.toLocaleString('pt-BR') + ' moedas</b><span>e <b>' + bank.xp + ' XP</b> nesta missão.</span></p>' +
      (notes.length ? '<p class="sub">' + notes.join(' · ') + '.</p>' : '') +
      '<p class="sub">Carteira: ' + wallet.coins.toLocaleString('pt-BR') + ' moedas · ' + wallet.xp + ' XP · nível ' + lv1 + '</p>';
    $('end-score').textContent = score;
    $('e-again').textContent = nextM ? 'Próxima missão' : 'Voar de novo';
    $('end').classList.toggle('crash', bad); show('end', true);
  }
  function paintMissions() {
    var box = $('missions'), lv = 1 + Math.floor(wallet.xp / 40); box.textContent = '';
    if (free && !wallet.prog) free = false; if (!free && FIELDS.indexOf(mission) > wallet.prog) mission = FIELDS[Math.min(wallet.prog, FIELDS.length - 1)];
    var pick = function (f, isFree) { return function () { free = isFree; if (f) mission = f; paintMissions(); resetGame(); }; };
    var btn = function (par, title, desc, sel, locked, fn) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mis' + (sel ? ' sel' : ''); b.disabled = locked; b.setAttribute('aria-pressed', sel ? 'true' : 'false');
      var t = document.createElement('b'); t.textContent = title; var d = document.createElement('span'); d.textContent = desc; b.appendChild(t); b.appendChild(d); b.addEventListener('click', fn); par.appendChild(b);
    };
    var row = null, farm = '';
    FIELDS.forEach(function (f, k) {
      if (f.farm !== farm) { farm = f.farm; var h = document.createElement('p'); h.className = 'farm'; h.textContent = farm; box.appendChild(h); row = document.createElement('div'); row.className = 'mrow'; box.appendChild(row); }
      var locked = k > wallet.prog; btn(row, (k < wallet.prog ? '✓ ' : '') + 'Missão ' + (k + 1), locked ? 'Bloqueada' : f.name + ' · ' + f.nSw + ' faixas', !free && mission === f, locked, pick(f, false));
    });
    var o = mission.obs || {}, ob = [];
    if (o.treesU || o.treesW) ob.push('mata'); if (o.wiresU || o.wiresW) ob.push('rede elétrica');
    $('m-info').textContent = free ? 'Voo livre: hopper cheio e todos os talhões para aplicar à vontade.' : mission.farm + ' · ' + mission.name + ' · ' + mission.prod + ' · ' + mission.nSw + ' faixas de ' + mission.len + ' m' + (ob.length ? ' · ' + ob.join(' e ') : '') + (tutor() ? ' · com o instrutor Naldinho' : '') + '.';
    btn(box, 'Voo livre', wallet.prog ? 'Todos os talhões, hopper cheio' : 'Libera ao concluir a Missão 1', free, !wallet.prog, pick(null, true));
    $('m-wallet').textContent = 'Carteira: ' + wallet.coins.toLocaleString('pt-BR') + ' moedas · ' + wallet.xp + ' XP · nível ' + lv;
  }
  function goFull() {
    try { var el = document.documentElement; if (!/Android/i.test(navigator.userAgent) || !el.requestFullscreen || document.fullscreenElement) return;
      el.requestFullscreen().then(function () { if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape'); }).catch(function () { }); } catch (e) { }
  }
  tap('m-tilt', function () {
    initAudio(); goFull(); $('menu-note').textContent = 'Verificando o sensor…';
    enableTilt().then(function (ok) {
      if (ok) { mode = 'tilt'; $('menu-note').textContent = ''; openCalib(false); }
      else $('menu-note').textContent = 'O sensor de movimento está bloqueado nesta tela. Ele funciona com o jogo aberto direto no navegador do celular (Safari ou Chrome), por um endereço https. Aqui, use o manche na tela.';
    });
  });
  tap('m-stick', function () { initAudio(); goFull(); mode = 'stick'; startPlay(); });
  tap('c-go', function () { calibrate(); show('calib', false); if (calibResume) { state = 'pause'; pause(false); show('hud', true); } else startPlay(); });
  tap('c-back', function () { show('calib', false); if (calibResume) { state = 'pause'; show('pause', true); } else { state = 'menu'; show('menu', true); } });
  tap('p-resume', function () { initAudio(); pause(false); });
  tap('o-recal', function () { openCalib(true); });
  tap('p-restart', function () { startPlay(); });
  tap('p-end', function () { show('pause', false); finish(null); });
  tap('e-again', function () { initAudio(); if (nextM) { mission = nextM; free = false; } startPlay(); });
  tap('e-menu', function () { show('end', false); paintMissions(); resetGame(); state = 'menu'; show('menu', true); });
  var optBtn = function (id, label, vals, get, set) {
    var el = $(id), paint = function () { el.textContent = label + ': ' + vals[get()]; }; paint();
    el.addEventListener('click', function () { set((get() + 1) % vals.length); paint(); });
  };
  optBtn('o-assist', 'Comando', ['direto (manche)', 'assistido'], function () { return opt.assist ? 1 : 0; }, function (v) { opt.assist = !!v; });
  optBtn('o-sens', 'Sensibilidade', ['baixa', 'média', 'alta'], function () { return opt.sens; }, function (v) { opt.sens = v; });
  optBtn('o-inv', 'Arfagem', ['normal', 'invertida'], function () { return opt.invert ? 1 : 0; }, function (v) { opt.invert = !!v; });
  optBtn('o-gfx', 'Gráficos', ['automático', 'sempre no máximo'], function () { return opt.gfx; }, function (v) { opt.gfx = v; if (v) setQuality(0); try { localStorage.setItem('voo-agricola.gfx', String(v)); } catch (e) { } });
  optBtn('o-snd', 'Som', ['desligado', 'ligado'], function () { return opt.sound ? 1 : 0; }, function (v) { opt.sound = !!v; if (v) initAudio(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(true); });

  // ---------- colisões e dano ----------
  var segs = [[[-7.9, -0.3, -0.3], [7.9, -0.3, -0.3]], [[0, 0, -5.2], [0, 0.2, 4.9]], [[0, 0.3, 4.2], [0, 2.1, 4.6]], [[0, -1.9, -1.3], [0, 0, -1.3]]];
  function hitWires() {
    if (flight.pos.y > 14) return; var near = false, px = flight.pos.x, pz = flight.pos.z;
    for (var bi = 0; bi < world.wireBoxes.length; bi++) { var bb = world.wireBoxes[bi]; if (!bb.off && px > bb.x0 && px < bb.x1 && pz > bb.z0 && pz < bb.z1) { near = true; break; } }
    if (!near) return;
    var dm = flight.dmg;
    for (var s = 0; s < segs.length; s++) {
      if (s === 3 && dm.gear === 2) continue;
      flight.worldPoint(segs[s][0], v1); flight.worldPoint(segs[s][1], v2);
      if (s === 0) { if (dm.wingL) v1.copy(flight.pos); if (dm.wingR) v2.copy(flight.pos); if (dm.wingL && dm.wingR) continue; }
      for (var i = 0; i < world.wires.length; i++) {
        var w = world.wires[i]; if (w.cut || w.off || segSegDist2(v1, v2, w.a, w.b) >= 0.2) continue;
        world.cutWire(i); sfx('tear');
        if (s === 0) { v3.set(1, 0, 0).applyQuaternion(flight.quat); var wt = clamp(((px - w.a.x) * (w.b.x - w.a.x) + (pz - w.a.z) * (w.b.z - w.a.z)) / w.a.distanceToSquared(w.b), 0, 1), sd = ((w.a.x + (w.b.x - w.a.x) * wt - px) * v3.x + (w.a.z + (w.b.z - w.a.z) * wt - pz) * v3.z + (w.a.y - flight.pos.y) * v3.y) > 0 ? 1 : -1; if (flight.tearWing(sd)) { flight.r += sd * 0.6; } }
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
        t = world.trees[i]; if (t.off || p.y >= t.h) continue;
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
    else if (ev === 'bounce') { sfx('touch', flight.lastSink + 1); if (!tutor()) say('Quicou. Segure a atitude e deixe o avião assentar.', 3); else talk('Quicou! Segura o manche.', 'bounce', true); }
    else if (ev === 'gearDamage') { boss('Ó, piloto ruim, meu Deuuus!', 'bravo', null, true, 8); sfx('crunch'); say('Pouso duro: trem de pouso avariado. O próximo toque forte derruba o trem.', 6); }
    else if (ev === 'gearCollapse') { sfx('crunch'); plane.gearParts.forEach(function (m) { m.visible = false; }); say('O trem de pouso cedeu.', 5); }
    else if (ev === 'slide') { sfx('crunch'); toggleSpray(false); }
    else if (ev === 'wingL' || ev === 'wingR') { boss('Ó, piloto ruim, meu Deuuus!', 'bravo', null, true, 8); sfx('tear'); detachWing(ev === 'wingL' ? -1 : 1); say(ev === 'wingL' ? 'Asa esquerda arrancada.' : 'Asa direita arrancada.', 5); }
    else if (ev === 'engine') { sfx('bang'); if (reverse > 0 || throttle > 0) { /* manete continua onde está; o motor não responde */ } say(dm.fire ? 'Motor destruído e em chamas.' : 'Hélice tocou o solo: motor parado.', 5); }
    else if (ev === 'tail') { sfx('tear'); say('Cauda atingida: sem leme.', 5); }
    else if (ev === 'destroyed') { fd.vis = false; show('fd', false); world.setLane(null);                               // perda total: o avião se parte
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
    windNow.set(wind.x + Math.sin(simT * 0.23) * 0.3, 0, wind.z + Math.cos(simT * 0.17) * 0.3);                // vento quase constante, sem rajada que mexa o avião sozinho
    var n = Math.max(1, Math.ceil(dt / H - 1e-6)), h = dt / n;
    for (var si = 0; si < n; si++) { flight.step(h, ctl, windNow); if (!flight.crashed && !flight.onGround) hitWires(); }
    if (!flight.crashed && (!flight.onGround || Math.abs(flight.vf) > 3)) hitObjects();
    while (flight.events.length) onEvent(flight.events.shift());
    if (flight.onGround !== wasGround) { if (!flight.onGround) { sfx('lift'); talk('Recolhe o flape e segue o pino verde.', 'lift'); } wasGround = flight.onGround; }
    if (flight.crashed) { wreckT += dt; if (wreckT > 3.2) finish(flight.crashed); return; }
    // aplicação
    if (spraying && flight.hopper > 0) {
      var gs = Math.sqrt(flight.vel.x * flight.vel.x + flight.vel.z * flight.vel.z);
      var lit = Math.min(flight.hopper, ref().rate * SWATH * Math.max(gs, 20) / 10000 * dt);
      flight.hopper -= lit; stats.applied += lit;
      spray.emit(flight, 9);
      var frac = 0;
      if (!flight.onGround && flight.hw <= H_MAX) {
        v1.set(1, 0, 0).applyQuaternion(flight.quat); var rl = Math.sqrt(v1.x * v1.x + v1.z * v1.z) || 1;
        frac = applySwath(lastX, lastZ, flight.pos.x, flight.pos.z, v1.x / rl, v1.z / rl, simT);
        lowNow = flight.hw <= H_LOW;
      }
      stats.waste += lit * (1 - frac);
      // produto indo fora: o patrão reclama
      if (!flight.onGround && frac < 0.3) { wasteT += dt; if (wasteT > 1.6 && simT - wasteSaid > 30) { wasteSaid = simT; wasteT = 0; boss('Ê, piloto, vai me falir! Tá jogando veneno no vento!', 'bravo', null, true, 0); } } else wasteT = Math.max(0, wasteT - dt * 2);
      if (flight.hopper <= 0) { toggleSpray(false); if (!hint.empty) { hint.empty = true; say('Hopper vazio. Volte para a Pista Scheffer: siga o pino branco e o arco.', 6); } }
    }
    lastX = flight.pos.x; lastZ = flight.pos.z;
    updateGame(dt);
    ACTIVE.forEach(function (f) { if (f.dirty && Math.floor(simT * 20) !== Math.floor((simT - dt) * 20)) { f.tex.needsUpdate = true; f.dirty = false; } });
    // dicas
    if (!tutor() && !hint.flap && !flight.onGround && flight.flap > 0 && flight.agl > 15 && flight.V * MS2KT > 92) { hint.flap = true; say('Recolha o flape. Sobre o talhão, desça abaixo de 65 ft e ligue a aplicação.', 7); }
    if (!hint.done && ACTIVE.every(function (f) { return f.done; })) { hint.done = true; if (free) rwQ.push({ c: 0, xp: 0, t: 'Tudo aplicado. Volte para a Pista Scheffer.', tier: 2 }); }
    if (flight.hasFlown && flight.onGround && Math.abs(flight.vf) < 0.3 && (lever === P0 || flight.belly || flight.dmg.engine)) { stopT += dt; if (stopT > (flight.belly ? 2.5 : 1.2)) finish(null); } else stopT = 0;
  }

  // ---------- câmera e visual ----------
  var camPos = new THREE.Vector3(), camHead = new THREE.Vector3(0, 0, -1), camSnap = true, flapVis = 0, menuA = 0.6, camDY = 4.6, camRoll = 0;
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
      camDY += ((4.6 - flight.gamma * 5) - camDY) * (camSnap ? 1 : 1 - Math.exp(-dt * 3)); camRoll += (flight.phi - camRoll) * (camSnap ? 1 : 1 - Math.exp(-dt * 6));
      camPos.copy(flight.pos).addScaledVector(camHead, -17.5); camPos.y += camDY; if (camPos.y < 1.4) camPos.y = 1.4;
      camera.position.copy(camPos); camera.up.set(0, 1, 0);
      v3.copy(flight.pos).addScaledVector(camHead, 14); v3.y += 2.8; camera.lookAt(v3); camera.rotateZ(-camRoll * 0.28);
      camSnap = false;
    }
    var fov = (camMode === 1 ? 72 : 60) + Math.min(10, flight.V * 0.1); if (Math.abs(fov - camera.fov) > 0.2) { camera.fov = fov; camera.updateProjectionMatrix(); }
    world.sky.position.copy(camera.position); world.sky.material.uniforms.time.value += dt;
  }

  var last = performance.now(), fAvg = 1 / 60, fVar = 0, fSlow = 0, fFast = 0, quality = 0, PR0 = PR;
  function setQuality(q) { quality = clamp(q, 0, 3); PR = Math.min(PR0, [PR0, 1.5, 1.15, 1.15][quality]); world.sun.castShadow = quality < 3; renderer.setPixelRatio(PR); layout(); fAvg = 1 / 60; fVar = 0; }
  function frame(t) {
    var dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000)); last = t;
    // qualidade automática: só reduz se o aparelho estiver mesmo engasgando. Uma taxa estável de 30 quadros
    // (o modo de economia de bateria costuma limitar o navegador a 30) não conta como lentidão.
    fAvg += (dt - fAvg) * 0.05; fVar += (Math.abs(dt - fAvg) - fVar) * 0.05;
    var capped = fAvg > 1 / 37 && fAvg < 1 / 26 && fVar < 0.006, slow = fAvg > 1 / 22 || (fAvg > 1 / 46 && !capped);
    if (state === 'play' && opt.gfx === 0) {
      if (slow) { fSlow += dt; fFast = 0; if (fSlow > 3 && quality < 3) { fSlow = 0; setQuality(quality + 1); } }
      else { fSlow = 0; if (quality > 0 && (fAvg < 1 / 54 || capped)) { fFast += dt; if (fFast > 10) { fFast = 0; setQuality(quality - 1); } } else fFast = 0; }
    }
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
  layout(); paintMissions(); resetGame(); requestAnimationFrame(frame);
  window.__game = { tilt: tilt, ctl: ctl, get mode() { return mode; }, flight: flight, get state() { return state; }, setThrottle: setThrottle, setLever: setLever, debris: debris, bank: bank, get tgt() { return tgt; }, wallet: wallet, get quality() { return quality; }, get fps() { return Math.round(1 / fAvg); }, rud: rud, setFlap: setFlap, opt: opt, fields: ACTIVE, all: FIELDS, get mission() { return mission; }, get free() { return free; }, get talking() { return document.getElementById('nal-t').textContent; }, stats: stats };
})();
