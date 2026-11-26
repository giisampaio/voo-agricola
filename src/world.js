// ===== Cenário, avião e aplicação =====
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function col(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

var SWATH = 24, RATE_L_HA = 30, RWY_HW = 11, RWY_HL = 450, GROUND_HALF = 2048;
var FIELDS = [
  { name: 'Talhão 1', cx: -520, cz: -150, len: 520, wid: 192, ux: 0, uz: 1, wx: 1, wz: 0 },
  { name: 'Talhão 2', cx: 560, cz: -420, len: 400, wid: 144, ux: 1, uz: 0, wx: 0, wz: 1 }
];
var SUN = new THREE.Vector3(0.52, 0.66, -0.38).normalize();

function canvasTex(w, h, draw, aniso) {
  var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  var g = cv.getContext('2d'); draw(g, w, h);
  var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = aniso || 1;
  return t;
}
function quadXZ(ax, az, bx, bz, cx, cz, dx, dz, y) {            // cantos A,B,C,D com uv (0,0)(1,0)(1,1)(0,1)
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  var up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0;       // garante a face voltada para cima
  g.setIndex(up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return g;
}
function fieldQuad(f, y, grow) {
  var l = f.len / 2 + (grow || 0), w = f.wid / 2 + (grow || 0);
  var p = function (u, v) { return [f.cx + f.ux * u + f.wx * v, f.cz + f.uz * u + f.wz * v]; };
  var A = p(-l, -w), B = p(-l, w), C = p(l, w), D = p(l, -w);
  return quadXZ(A[0], A[1], B[0], B[1], C[0], C[1], D[0], D[1], y);
}
function inRect(x, z, x0, x1, z0, z1) { return x > x0 && x < x1 && z > z0 && z < z1; }

function buildWorld(scene, aniso) {
  var R = rng(20261126), W = { trees: [], boxes: [], wires: [], fields: FIELDS };
  var flatMat = function (hex, extra) { var m = new THREE.MeshLambertMaterial(Object.assign({ color: col(hex) }, extra || {})); return m; };

  // ---------- céu ----------
  var skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: SUN }, cHor: { value: new THREE.Color('#cfdbe0') }, cZen: { value: new THREE.Color('#3f7fc4') }, time: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'precision highp float; varying vec3 vDir; uniform vec3 sunDir; uniform vec3 cHor; uniform vec3 cZen; uniform float time;',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
      'float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x), f.y); }',
      'float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.03+vec2(7.1,3.3); a*=0.5; } return v; }',
      'void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0);',
      ' vec3 c = mix(cHor, cZen, pow(h, 0.5));',
      ' float s = max(dot(d, sunDir), 0.0);',
      ' c += vec3(1.0,0.92,0.75)*pow(s, 420.0)*1.6 + vec3(1.0,0.88,0.65)*pow(s, 9.0)*0.16;',
      ' if (d.y > 0.015){ vec2 uv = d.xz/(d.y+0.10)*1.1 + vec2(time*0.003, 0.0); float n = fbm(uv);',
      '  float m = smoothstep(0.50, 0.74, n) * smoothstep(0.015, 0.20, d.y);',
      '  vec3 cc = mix(vec3(0.78,0.81,0.86), vec3(1.0,1.0,0.98), smoothstep(0.55, 0.85, n + s*0.25));',
      '  c = mix(c, cc, m*0.92); }',
      ' gl_FragColor = vec4(c, 1.0); }'].join('\n')
  });
  W.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), skyMat); W.sky.renderOrder = -10; W.sky.frustumCulled = false;
  scene.add(W.sky);
  scene.fog = new THREE.Fog(col('#cfdbe0'), 900, 8200);

  // ---------- luz ----------
  scene.add(new THREE.HemisphereLight(col('#d7e6ff'), col('#8f7d58'), 0.78));
  var sun = new THREE.DirectionalLight(col('#fff1d6'), 1.12);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  var sc = sun.shadow.camera; sc.left = -15; sc.right = 15; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 520;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target); W.sun = sun;

  // ---------- solo: mosaico de lavouras ----------
  var BASE = '#8c9157';
  var gtex = canvasTex(2048, 2048, function (g, w, h) {
    var X = function (x) { return (x + GROUND_HALF) / 2; };
    g.fillStyle = '#a2643f'; g.fillRect(0, 0, w, h);                       // estradas / carreadores de terra
    var pal = [['#587c36', 5], ['#64883c', 4], ['#4f7231', 3], ['#7c8f47', 3], ['#939c5c', 4], ['#b9a66b', 3], ['#8b5136', 2], ['#34512a', 2], ['#a59a60', 2]];
    var tot = 0; pal.forEach(function (p) { tot += p[1]; });
    var leaf = function (x, y, ww, hh) {
      var r = R() * tot, c = pal[0][0]; for (var i = 0; i < pal.length; i++) { r -= pal[i][1]; if (r <= 0) { c = pal[i][0]; break; } }
      g.fillStyle = c; g.fillRect(x + 2, y + 2, ww - 4, hh - 4);
      g.save(); g.beginPath(); g.rect(x + 2, y + 2, ww - 4, hh - 4); g.clip();
      var horiz = R() < 0.5, k;
      g.globalAlpha = 0.07; g.strokeStyle = R() < 0.5 ? '#000' : '#fff'; g.lineWidth = 1; g.beginPath();
      if (horiz) for (k = y; k < y + hh; k += 3) { g.moveTo(x, k + 0.5); g.lineTo(x + ww, k + 0.5); }
      else for (k = x; k < x + ww; k += 3) { g.moveTo(k + 0.5, y); g.lineTo(k + 0.5, y + hh); }
      g.stroke();
      g.globalAlpha = 0.10;                                                // manchas de solo e umidade
      for (k = 0; k < 6; k++) { g.fillStyle = R() < 0.5 ? '#2c2a12' : '#e6dc9a'; g.beginPath(); g.ellipse(x + R() * ww, y + R() * hh, 10 + R() * 50, 6 + R() * 30, R() * 3, 0, 6.3); g.fill(); }
      g.restore();
    };
    var split = function (x, y, ww, hh) {
      var big = Math.max(ww, hh);
      if (big < 150 || (big < 330 && R() < 0.55)) { leaf(x, y, ww, hh); return; }
      var f = 0.35 + R() * 0.3;
      if (ww > hh) { var a = Math.round(ww * f); split(x, y, a, hh); split(x + a, y, ww - a, hh); }
      else { var b = Math.round(hh * f); split(x, y, ww, b); split(x, y + b, ww, hh - b); }
    };
    split(0, 0, w, h);
    // sede: pasto em volta da pista e pátio de terra
    g.fillStyle = '#98a05f'; g.fillRect(X(-70), X(-520), 120, 520);
    g.fillStyle = '#a2643f'; g.fillRect(X(11), X(330), 75, 65);
    g.fillRect(X(30), X(395), 5, 400); g.fillRect(X(-2048), X(790), 2048, 5);
    // carreadores em volta dos talhões
    FIELDS.forEach(function (f) {
      var hx = (Math.abs(f.ux) * f.len + Math.abs(f.wx) * f.wid) / 2 + 10, hz = (Math.abs(f.uz) * f.len + Math.abs(f.wz) * f.wid) / 2 + 10;
      g.fillStyle = '#a2643f'; g.fillRect(X(f.cx - hx), X(f.cz - hz), hx, hz);
    });
    g.globalAlpha = 0.05;
    for (var i = 0; i < 70000; i++) { g.fillStyle = R() < 0.5 ? '#000' : '#fff'; g.fillRect(R() * w, R() * h, 1 + R() * 2, 1 + R() * 2); }
    g.globalAlpha = 1;
    // borda se dissolve na cor base (o resto do mundo repete essa cor)
    var e = 180, gr;
    gr = g.createLinearGradient(0, 0, e, 0); gr.addColorStop(0, BASE); gr.addColorStop(1, 'rgba(140,145,87,0)'); g.fillStyle = gr; g.fillRect(0, 0, e, h);
    gr = g.createLinearGradient(w, 0, w - e, 0); gr.addColorStop(0, BASE); gr.addColorStop(1, 'rgba(140,145,87,0)'); g.fillStyle = gr; g.fillRect(w - e, 0, e, h);
    gr = g.createLinearGradient(0, 0, 0, e); gr.addColorStop(0, BASE); gr.addColorStop(1, 'rgba(140,145,87,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, e);
    gr = g.createLinearGradient(0, h, 0, h - e); gr.addColorStop(0, BASE); gr.addColorStop(1, 'rgba(140,145,87,0)'); g.fillStyle = gr; g.fillRect(0, h - e, w, e);
    g.fillStyle = BASE; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
  }, aniso);
  var detail = canvasTex(256, 256, function (g, w, h) {
    var im = g.createImageData(w, h), i, v;
    for (i = 0; i < w * h; i++) { v = 170 + Math.floor(R() * 85); if (R() < 0.08) v -= 50; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
  }, aniso);
  detail.encoding = THREE.LinearEncoding; detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  var gmat = new THREE.MeshLambertMaterial({ map: gtex });
  gmat.onBeforeCompile = function (sh) {
    sh.uniforms.detailMap = { value: detail };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= (texture2D(detailMap, vUv*1100.0).r*0.62 + texture2D(detailMap, vUv*97.0).r*0.62);');
  };
  var BIG = 14000, ggeo = new THREE.BufferGeometry(), uvS = BIG / (2 * GROUND_HALF);
  ggeo.setAttribute('position', new THREE.Float32BufferAttribute([-BIG, 0, BIG, BIG, 0, BIG, BIG, 0, -BIG, -BIG, 0, -BIG], 3));
  ggeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  ggeo.setAttribute('uv', new THREE.Float32BufferAttribute([0.5 - uvS, 0.5 - uvS, 0.5 + uvS, 0.5 - uvS, 0.5 + uvS, 0.5 + uvS, 0.5 - uvS, 0.5 + uvS], 2));
  ggeo.setIndex([0, 1, 2, 0, 2, 3]);
  var ground = new THREE.Mesh(ggeo, gmat); ground.receiveShadow = true; scene.add(ground);

  var decal = function (geo, mat, order) { mat.polygonOffset = true; mat.polygonOffsetFactor = -order; mat.polygonOffsetUnits = -order * 2; var m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.renderOrder = order; scene.add(m); return m; };

  // ---------- pista de terra ----------
  var rtex = canvasTex(128, 1024, function (g, w, h) {
    g.fillStyle = '#b0714a'; g.fillRect(0, 0, w, h);
    var i; g.globalAlpha = 0.10;
    for (i = 0; i < 5000; i++) { g.fillStyle = R() < 0.5 ? '#5c3320' : '#e2b58d'; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 9); }
    g.globalAlpha = 0.22; g.fillStyle = '#c99873';
    g.fillRect(w * 0.5 - 22, 0, 12, h); g.fillRect(w * 0.5 + 10, 0, 12, h);          // trilhas das rodas
    g.globalAlpha = 0.5; g.fillStyle = '#869156'; g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);
    g.globalAlpha = 1;
  }, aniso);
  decal(quadXZ(-RWY_HW, RWY_HL, RWY_HW, RWY_HL, RWY_HW, -RWY_HL, -RWY_HW, -RWY_HL, 0.02), new THREE.MeshLambertMaterial({ map: rtex }), 1);
  var mk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.35, 1.6), flatMat('#f1efe6'), 40), M = new THREE.Matrix4(), n = 0;
  for (var zz = -RWY_HL; zz <= RWY_HL; zz += 100) { M.makeTranslation(-RWY_HW - 1, 0.17, zz); mk.setMatrixAt(n++, M); M.makeTranslation(RWY_HW + 1, 0.17, zz); mk.setMatrixAt(n++, M); }
  mk.count = n; scene.add(mk);

  // ---------- talhões ----------
  var rowTex = canvasTex(128, 128, function (g, w, h) {
    g.fillStyle = '#5a3f28'; g.fillRect(0, 0, w, h);
    for (var r = 0; r < 4; r++) {
      var x0 = r * 32 + 4; g.fillStyle = '#4d7a2b'; g.fillRect(x0, 0, 24, h);
      for (var i = 0; i < 260; i++) { g.fillStyle = ['#3d6a22', '#5e8e33', '#6c9a3a', '#447326'][Math.floor(R() * 4)]; g.fillRect(x0 - 2 + R() * 26, R() * h, 2 + R() * 5, 2 + R() * 5); }
    }
  }, aniso);
  rowTex.wrapS = rowTex.wrapT = THREE.RepeatWrapping;
  var stakeN = 0; FIELDS.forEach(function (f) { stakeN += 2 * Math.round(f.wid / SWATH); });
  var stakes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.8, 0.14), flatMat('#ffffff'), stakeN), flags = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.45, 0.06), flatMat('#ff7a1a'), stakeN), si = 0;
  FIELDS.forEach(function (f) {
    f.nSw = Math.round(f.wid / SWATH);
    var base = decal(fieldQuad(f, 0.03, 0), new THREE.MeshLambertMaterial({ map: rowTex.clone() }), 2);
    base.material.map.needsUpdate = true; base.material.map.repeat.set(f.wid / 2, f.len / 2);
    var cv = document.createElement('canvas'); cv.width = f.wid; cv.height = f.len;
    f.ctx = cv.getContext('2d');
    f.tex = new THREE.CanvasTexture(cv); f.tex.encoding = THREE.sRGBEncoding; f.tex.generateMipmaps = false; f.tex.minFilter = THREE.LinearFilter;
    decal(fieldQuad(f, 0.05, 0), new THREE.MeshBasicMaterial({ map: f.tex, transparent: true, depthWrite: false }), 3);
    f.grid = new Uint8Array(f.wid * f.len); f.ovl = new Uint8Array(f.wid * f.len); f.sw = new Int32Array(f.nSw);
    for (var i = 0; i < f.nSw; i++) for (var e = -1; e <= 1; e += 2) {
      var u = e * (f.len / 2 + 6), w = -f.wid / 2 + (i + 0.5) * SWATH, x = f.cx + f.ux * u + f.wx * w, z = f.cz + f.uz * u + f.wz * w;
      M.makeTranslation(x, 0.9, z); stakes.setMatrixAt(si, M);
      M.makeRotationY(f.ux ? Math.PI / 2 : 0); M.setPosition(x + (f.ux ? 0 : 0.4), 1.55, z + (f.ux ? 0.4 : 0)); flags.setMatrixAt(si, M); si++;
    }
  });
  scene.add(stakes); scene.add(flags);

  // ---------- árvores ----------
  var T = W.trees;
  var blocked = function (x, z) {
    if (Math.abs(x) < 90 && Math.abs(z) < 1100) return true;                                  // pista e eixos de decolagem/aproximação
    if (inRect(x, z, 0, 160, 300, 460)) return true;                                          // sede
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i], u = (x - f.cx) * f.ux + (z - f.cz) * f.uz, w = (x - f.cx) * f.wx + (z - f.cz) * f.wz;
      if (Math.abs(u) < f.len / 2 + 520 && Math.abs(w) < f.wid / 2 + 70) return true;         // talhão e entradas/saídas
    }
    return false;
  };
  var tree = function (x, z, h, force) { if (!force && blocked(x, z)) return; T.push({ x: x, z: z, h: h, r: h * (0.30 + R() * 0.12) }); };
  var x, z, i, a, d;
  for (x = -640; x <= -400; x += 6.5) { tree(x + R() * 2, -428 + R() * 2, 10 + R() * 4, true); tree(x + 3 + R() * 2, -436 + R() * 2, 11 + R() * 4, true); }   // quebra-vento ao norte do talhão 1
  for (z = -488; z <= -338; z += 6.5) { tree(780 + R() * 2, z + R() * 2, 10 + R() * 4, true); tree(788 + R() * 2, z + 3 + R() * 2, 11 + R() * 5, true); }     // cortina a leste do talhão 2
  [[-1150, -950, 280, 130], [950, 560, 240, 110], [230, -1380, 250, 100], [-900, 900, 300, 120], [1500, -1100, 260, 90]].forEach(function (b) {
    for (i = 0; i < b[3]; i++) { a = R() * 6.283; d = Math.sqrt(R()) * b[2]; tree(b[0] + Math.cos(a) * d, b[1] + Math.sin(a) * d * 0.7, 9 + R() * 8); }
  });
  for (i = 0; i < 90; i++) tree((R() - 0.5) * 3800, (R() - 0.5) * 3800, 7 + R() * 7);
  [[128, 418], [136, 428], [122, 440], [140, 410], [96, 452]].forEach(function (p) { tree(p[0], p[1], 8 + R() * 4, true); });
  var crownG = new THREE.IcosahedronGeometry(1, 1), trunkG = new THREE.CylinderGeometry(0.5, 0.7, 1, 6), shG = new THREE.CircleGeometry(1, 12);
  shG.rotateX(-Math.PI / 2);
  var crowns = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0xffffff }), T.length * 2);
  var trunks = new THREE.InstancedMesh(trunkG, flatMat('#5b4633'), T.length);
  var shMat = new THREE.MeshBasicMaterial({ color: 0x0c1408, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  var shads = new THREE.InstancedMesh(shG, shMat, T.length); shads.renderOrder = 4;
  var Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), C = new THREE.Color(), greens = ['#2f5a24', '#3a6a2a', '#27501f', '#44752f', '#335f2b'];
  T.forEach(function (t, k) {
    var th = t.h * 0.42;
    M.compose(P.set(t.x, th / 2, t.z), Q.identity(), Sc.set(t.r * 0.18, th, t.r * 0.18)); trunks.setMatrixAt(k, M);
    Q.setFromAxisAngle(P.set(0, 1, 0), R() * 6.28);
    M.compose(P.set(t.x, t.h * 0.66, t.z), Q, Sc.set(t.r, t.h * 0.36, t.r)); crowns.setMatrixAt(k * 2, M);
    C.copy(col(greens[Math.floor(R() * greens.length)])); crowns.setColorAt(k * 2, C);
    M.compose(P.set(t.x + (R() - 0.5) * t.r * 0.7, t.h * 0.52, t.z + (R() - 0.5) * t.r * 0.7), Q, Sc.set(t.r * 0.8, t.h * 0.26, t.r * 0.8)); crowns.setMatrixAt(k * 2 + 1, M);
    C.multiplyScalar(0.85); crowns.setColorAt(k * 2 + 1, C);
    var off = t.h * 0.55; Q.identity();
    M.compose(P.set(t.x - SUN.x / SUN.y * off, 0.04, t.z - SUN.z / SUN.y * off), Q, Sc.set(t.r * 1.15, 1, t.r * 1.15)); shads.setMatrixAt(k, M);
  });
  scene.add(crowns); scene.add(trunks); scene.add(shads);

  // ---------- rede elétrica ao norte do talhão 2 ----------
  var poles = [], WH = 8.5; for (x = 300; x <= 840; x += 60) poles.push([x, -500]);
  var poleM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 9.4, 8), flatMat('#6e6a60'), poles.length);
  var armM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.14, 2.2), flatMat('#57534a'), poles.length);
  var ballM = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), flatMat('#ff6a13'), (poles.length - 1) * 2);
  var lp = [];
  poles.forEach(function (p, k) {
    M.makeTranslation(p[0], 4.7, p[1]); poleM.setMatrixAt(k, M); M.makeTranslation(p[0], WH + 0.05, p[1]); armM.setMatrixAt(k, M);
    T.push({ x: p[0], z: p[1], h: 9.4, r: 0.5, pole: true });
    if (k) for (var s = -1; s <= 1; s += 2) {
      var q = poles[k - 1], zz = p[1] + s * 1.0;
      W.wires.push({ a: new THREE.Vector3(q[0], WH, zz), b: new THREE.Vector3(p[0], WH, zz) });
      lp.push(q[0], WH, zz, (q[0] + p[0]) / 2, WH - 0.45, zz, (q[0] + p[0]) / 2, WH - 0.45, zz, p[0], WH, zz);
      M.makeTranslation((q[0] + p[0]) / 2, WH - 0.45, zz); ballM.setMatrixAt((k - 1) * 2 + (s > 0 ? 1 : 0), M);
    }
  });
  var lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1b1b1b })));
  var lp0 = lp.slice();
  W.cutWire = function (i) {                                   // cabo rompido cai no chão
    var w = W.wires[i], a = lg.attributes.position; if (w.cut) return; w.cut = true;
    a.setY(i * 4 + 1, 0.15); a.setY(i * 4 + 2, 0.15); a.needsUpdate = true;
    M.makeTranslation((w.a.x + w.b.x) / 2, 0.32, w.a.z); ballM.setMatrixAt(i, M); ballM.instanceMatrix.needsUpdate = true;
  };
  W.resetWires = function () {
    var a = lg.attributes.position; a.array.set(lp0); a.needsUpdate = true;
    W.wires.forEach(function (w, i) { w.cut = false; M.makeTranslation((w.a.x + w.b.x) / 2, WH - 0.45, w.a.z); ballM.setMatrixAt(i, M); });
    ballM.instanceMatrix.needsUpdate = true;
  };
  scene.add(poleM); scene.add(armM); scene.add(ballM);

  // ---------- sede: hangar, silos, caminhão, biruta ----------
  var box = function (x0, x1, z0, z1, h, hex, y0) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), flatMat(hex)); m.position.set((x0 + x1) / 2, (y0 || 0) + h / 2, (z0 + z1) / 2); scene.add(m);
    if (!y0) W.boxes.push({ x0: x0, x1: x1, z0: z0, z1: z1, h: h }); return m;
  };
  box(44, 66, 362, 392, 6, '#d9dcd6');
  var roof = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 30, 24), flatMat('#9aa3a6')); roof.rotation.x = Math.PI / 2; roof.scale.set(1, 1, 0.42); roof.position.set(55, 6, 377); scene.add(roof);
  W.boxes.push({ x0: 44, x1: 66, z0: 362, z1: 392, h: 10.8 });
  box(43.8, 44.1, 366, 388, 5, '#3b4347', 0.01);
  box(104, 118, 424, 436, 3.6, '#e8dcc2'); box(103, 119, 423, 437, 0.5, '#9b4a34', 3.6);
  box(24, 27, 398, 406, 2.6, '#f4f4f0'); box(24.2, 26.8, 406, 409, 2.2, '#2f6fb4');
  [[88, 338], [98, 338]].forEach(function (p) {
    var s = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 10, 16), flatMat('#c9ced1')); s.position.set(p[0], 5, p[1]); scene.add(s);
    var c2 = new THREE.Mesh(new THREE.ConeGeometry(4.2, 2.6, 16), flatMat('#b4babd')); c2.position.set(p[0], 11.3, p[1]); scene.add(c2);
    T.push({ x: p[0], z: p[1], h: 12.6, r: 4.2, pole: true });
  });
  var wsP = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6, 6), flatMat('#dddddd')); wsP.position.set(-26, 3, 250); scene.add(wsP);
  var ws = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.16, 3.2, 10, 1, true), new THREE.MeshLambertMaterial({ color: col('#ff6a13'), side: THREE.DoubleSide }));
  ws.geometry.rotateX(Math.PI / 2); ws.geometry.translate(0, 0, 1.6);
  W.sock = new THREE.Group(); W.sock.position.set(-26, 6, 250); W.sock.add(ws); scene.add(W.sock);
  T.push({ x: -26, z: 250, h: 6.2, r: 0.4, pole: true });
  return W;
}

// ===================== avião =====================
function loftBody(secs, seg, e) {
  var pos = [], idx = [], i, j, s, a, ca, sa;
  for (i = 0; i < secs.length; i++) { s = secs[i]; for (j = 0; j < seg; j++) { a = j / seg * Math.PI * 2; ca = Math.cos(a); sa = Math.sin(a); pos.push(s[1] * Math.sign(ca) * Math.pow(Math.abs(ca), e), s[3] + s[2] * Math.sign(sa) * Math.pow(Math.abs(sa), e), s[0]); } }
  for (i = 0; i < secs.length - 1; i++) for (j = 0; j < seg; j++) { var a0 = i * seg + j, a1 = i * seg + (j + 1) % seg; idx.push(a0, a0 + seg, a1, a1, a0 + seg, a1 + seg); }
  [0, secs.length - 1].forEach(function (k) { var c = pos.length / 3; pos.push(0, secs[k][3], secs[k][0]); for (j = 0; j < seg; j++) idx.push(c, k * seg + j, k * seg + (j + 1) % seg); });
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function loftWing(x0, x1, c0, c1, z0, z1, y0, y1, t) {
  var N = 10, prof = [], i, x, yt, cam;
  for (i = 0; i <= N; i++) { x = 0.5 * (1 - Math.cos(Math.PI * i / N)); yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x); cam = 0.08 * x * (1 - x); prof.push([x, cam + yt]); }
  for (i = N; i >= 0; i--) { x = 0.5 * (1 - Math.cos(Math.PI * i / N)); yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x); cam = 0.08 * x * (1 - x); prof.push([x, cam - yt]); }
  var L = prof.length, pos = [], idx = [];
  prof.forEach(function (p) { pos.push(x0, y0 + p[1] * c0, z0 + p[0] * c0); });
  prof.forEach(function (p) { pos.push(x1, y1 + p[1] * c1, z1 + p[0] * c1); });
  for (i = 0; i < L; i++) { var a = i, b = (i + 1) % L; idx.push(a, a + L, b, b, a + L, b + L); }
  for (i = 1; i < L - 1; i++) { idx.push(L, L + i, L + i + 1); idx.push(0, i, i + 1); }
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function buildAircraft() {
  var G_ = new THREE.Group(), A = { group: G_ };
  var std = function (hex, r, m) { return new THREE.MeshStandardMaterial({ color: col(hex), roughness: r, metalness: m || 0, side: THREE.DoubleSide }); };
  var yel = std('#f3c010', 0.42, 0.05), blue = std('#1b3c7c', 0.45, 0.05), dark = std('#22262a', 0.6, 0.2), metal = std('#a9aeb2', 0.35, 0.7), tire = std('#141414', 0.9, 0);
  var add = function (geo, mat, x, y, z, parent) { var m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); (parent || G_).add(m); return m; };
  add(loftBody([[-4.62, 0.30, 0.30, 0.05], [-4.2, 0.43, 0.43, 0.05], [-3.2, 0.52, 0.56, 0.06], [-2.0, 0.58, 0.70, 0.12], [-0.6, 0.60, 0.80, 0.20], [0.5, 0.58, 0.82, 0.22], [1.7, 0.50, 0.70, 0.18], [2.9, 0.35, 0.50, 0.12], [4.0, 0.19, 0.33, 0.08], [4.95, 0.05, 0.18, 0.10]], 16, 0.78), yel);
  add(loftBody([[-4.0, 0.36, 0.05, 0.50], [-2.1, 0.44, 0.05, 0.82], [-0.5, 0.40, 0.05, 1.0]], 8, 1), dark);                    // painel antirreflexo
  var sp = add(new THREE.ConeGeometry(0.3, 0.62, 16), metal, 0, 0.05, -4.92); sp.rotation.x = -Math.PI / 2;
  [-1, 1].forEach(function (s) { var ex = add(new THREE.CylinderGeometry(0.08, 0.1, 0.7, 8), dark, s * 0.5, -0.12, -3.75); ex.rotation.set(Math.PI / 2.4, 0, -s * 0.5); });
  // hélice: disco borrado
  var ptex = canvasTex(128, 128, function (g, w, h) {
    g.translate(64, 64);
    for (var k = 0; k < 3; k++) { g.rotate(Math.PI * 2 / 3); var gr = g.createLinearGradient(0, 0, 0, -62); gr.addColorStop(0, 'rgba(20,20,20,0)'); gr.addColorStop(0.3, 'rgba(25,25,25,0.75)'); gr.addColorStop(0.92, 'rgba(25,25,25,0.75)'); gr.addColorStop(1, 'rgba(240,200,0,0.9)'); g.fillStyle = gr; g.beginPath(); g.ellipse(0, -34, 5.5, 29, 0, 0, 6.3); g.fill(); }
  });
  A.prop = add(new THREE.CircleGeometry(1.35, 32), new THREE.MeshBasicMaterial({ map: ptex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }), 0, 0.05, -4.8);
  A.blur = add(new THREE.CircleGeometry(1.35, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }), 0, 0.05, -4.79);
  // cabine
  A.canopy = add(loftBody([[0.05, 0.30, 0.10, 0.98], [0.45, 0.44, 0.50, 1.02], [1.25, 0.44, 0.56, 1.02], [2.0, 0.36, 0.34, 0.86], [2.9, 0.12, 0.08, 0.62]], 12, 0.7), std('#16222c', 0.12, 0.6));
  add(new THREE.BoxGeometry(0.5, 0.05, 1.5), yel, 0, 1.58, 0.95);
  // asas
  var DIH = 3.5 * D2R; A.ail = []; A.flaps = []; A.wings = []; A.gearParts = [];
  [-1, 1].forEach(function (s) {
    var wg = new THREE.Group(); wg.position.set(0, -0.52, 0); wg.rotation.z = s * DIH; G_.add(wg); A.wings.push(wg);
    add(loftWing(s * 0.3, s * 7.55, 1.45, 1.45, -1.05, -1.05, 0, 0, 0.15), yel, 0, 0, 0, wg);
    add(loftWing(s * 7.55, s * 7.92, 1.45, 1.15, -1.05, -0.95, 0, 0.1, 0.13), blue, 0, 0, 0, wg);
    var surf = function (xa, xb, list) { var h = new THREE.Group(); h.position.set(s * (xa + xb) / 2, 0.03, 0.40); wg.add(h); add(new THREE.BoxGeometry(xb - xa - 0.04, 0.06, 0.38), yel, 0, 0, 0.19, h); list.push(h); };
    surf(0.62, 4.1, A.flaps); surf(4.1, 7.5, A.ail);
    // trem principal
    var leg = add(new THREE.BoxGeometry(0.1, 1.42, 0.34), yel, s * 0.96, -1.06, -1.3); leg.rotation.z = s * 0.72;
    var wh = add(new THREE.CylinderGeometry(0.37, 0.37, 0.28, 16), tire, s * 1.45, -1.53, -1.3); wh.rotation.z = Math.PI / 2;
    var hub = add(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10), metal, s * 1.45, -1.53, -1.3); hub.rotation.z = Math.PI / 2;
    A.gearParts.push(leg, wh, hub);
    // estabilizador
    add(loftWing(s * 0.1, s * 2.65, 1.0, 0.85, 3.55, 3.6, 0.28, 0.28, 0.10), yel);
  });
  A.elev = new THREE.Group(); A.elev.position.set(0, 0.29, 4.5); G_.add(A.elev); add(new THREE.BoxGeometry(5.2, 0.05, 0.45), yel, 0, 0, 0.22, A.elev);
  var fin = add(loftWing(0.25, 1.9, 1.55, 0.95, 3.15, 3.85, 0, 0, 0.09), yel); fin.rotation.z = Math.PI / 2;
  var finTip = add(loftWing(1.9, 2.12, 0.95, 0.8, 3.85, 3.98, 0, 0, 0.09), blue); finTip.rotation.z = Math.PI / 2;
  add(new THREE.BoxGeometry(0.06, 0.5, 0.06), metal, 0, -0.52, 4.3); var tw = add(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 10), tire, 0, -0.83, 4.3); tw.rotation.z = Math.PI / 2;
  // barra de pulverização e bomba eólica
  var boom = add(new THREE.CylinderGeometry(0.035, 0.035, 13.4, 6), metal, 0, -0.80, 0.78); boom.rotation.z = Math.PI / 2;
  for (var k = -6; k <= 6; k += 1.5) if (Math.abs(k) > 0.8) add(new THREE.BoxGeometry(0.04, 0.3, 0.04), metal, k, -0.66, 0.72);
  add(new THREE.BoxGeometry(0.34, 0.3, 0.6), metal, 0, -0.78, -0.4);
  G_.traverse(function (o) { if (o.isMesh && o !== A.prop && o !== A.blur) { o.castShadow = true; } });
  return A;
}

// ===================== névoa da aplicação =====================
function makeSpray(scene) {
  var N = 1300, pos = new Float32Array(N * 3), al = new Float32Array(N), vel = new Float32Array(N * 3), life = new Float32Array(N), head = 0;
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(al, 1));
  var mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
    vertexShader: 'attribute float aA; varying float vA; uniform float uScale; void main(){ vA = aA; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = min(64.0, (0.8 + (1.0-aA)*2.6)*uScale/max(1.0,-mv.z)); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'precision mediump float; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); if (d>0.5) discard; gl_FragColor = vec4(0.94,0.97,1.0, vA*0.30*(1.0-d*2.0)); }'
  });
  var pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 20; scene.add(pts);
  var v = new THREE.Vector3();
  return {
    mat: mat,
    emit: function (fl, count) {
      for (var i = 0; i < count; i++) {
        var k = head; head = (head + 1) % N;
        v.set((Math.random() * 2 - 1) * 6.6, -0.85, 0.9).applyQuaternion(fl.quat).add(fl.pos);
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        vel[k * 3] = fl.vel.x * 0.22 + (Math.random() - 0.5) * 2; vel[k * 3 + 1] = -2.2 - Math.random() * 1.5; vel[k * 3 + 2] = fl.vel.z * 0.22 + (Math.random() - 0.5) * 2;
        life[k] = 1;
      }
    },
    update: function (dt) {
      var dmp = Math.max(0, 1 - 2.2 * dt);
      for (var k = 0; k < N; k++) {
        if (life[k] <= 0) { al[k] = 0; continue; }
        life[k] -= dt / 1.7; vel[k * 3] *= dmp; vel[k * 3 + 2] *= dmp;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        if (pos[k * 3 + 1] < 0.1) life[k] = 0;
        al[k] = Math.max(0, life[k]);
      }
      g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true;
    },
    clear: function () { life.fill(0); al.fill(0); g.attributes.aA.needsUpdate = true; }
  };
}

// ===================== fogo e fumaça =====================
function makePuffs(scene, N, o) {
  var pos = new Float32Array(N * 3), al = new Float32Array(N), sz = new Float32Array(N), vel = new Float32Array(N * 3), life = new Float32Array(N), span = new Float32Array(N), s0 = new Float32Array(N), s1 = new Float32Array(N), head = 0;
  var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(al, 1)); g.setAttribute('aS', new THREE.BufferAttribute(sz, 1));
  var mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 600 }, c0: { value: new THREE.Color(o.c0) }, c1: { value: new THREE.Color(o.c1) }, uA: { value: o.alpha } },
    vertexShader: 'attribute float aA; attribute float aS; varying float vA; uniform float uScale; void main(){ vA = aA; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = min(256.0, aS*uScale/max(1.0,-mv.z)); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'precision mediump float; varying float vA; uniform vec3 c0; uniform vec3 c1; uniform float uA; void main(){ float d = length(gl_PointCoord-0.5); if (d>0.5 || vA<=0.0) discard; float f = min(1.0, vA*2.5)*min(1.0,(1.0-vA)*8.0+0.25); gl_FragColor = vec4(mix(c1, c0, vA), uA*f*(1.0-d*2.0)); }'
  });
  var pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = o.additive ? 22 : 21; scene.add(pts);
  return {
    mat: mat,
    emit: function (x, y, z, vx, vy, vz, sec, a, b) { var k = head; head = (head + 1) % N; pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; vel[k * 3] = vx; vel[k * 3 + 1] = vy; vel[k * 3 + 2] = vz; life[k] = 1; span[k] = sec; s0[k] = a; s1[k] = b; },
    update: function (dt) {
      var dmp = Math.max(0, 1 - o.drag * dt);
      for (var k = 0; k < N; k++) {
        if (life[k] <= 0) { al[k] = 0; continue; }
        life[k] -= dt / span[k]; vel[k * 3] *= dmp; vel[k * 3 + 2] *= dmp; vel[k * 3 + 1] += (o.rise - vel[k * 3 + 1]) * Math.min(1, dt * 1.5);
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        if (pos[k * 3 + 1] < 0.1) pos[k * 3 + 1] = 0.1;
        al[k] = Math.max(0, life[k]); sz[k] = s0[k] + (s1[k] - s0[k]) * (1 - al[k]);
      }
      g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true; g.attributes.aS.needsUpdate = true;
    },
    clear: function () { life.fill(0); al.fill(0); g.attributes.aA.needsUpdate = true; }
  };
}

// ===================== cobertura =====================
function resetFields() {
  FIELDS.forEach(function (f) { f.grid.fill(0); f.ovl.fill(0); f.sw.fill(0); f.cov = 0; f.over = 0; f.pass = 0; f.lastHit = -99; f.ctx.clearRect(0, 0, f.wid, f.len); f.tex.needsUpdate = true; f.dirty = false; });
}
// pinta a faixa entre duas posições do avião; devolve a fração das amostras que caiu dentro de um talhão
function applySwath(x0, z0, x1, z1, rx, rz, now) {
  var dist = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0)), steps = Math.max(1, Math.ceil(dist / 0.6)), inside = 0, total = 0;
  for (var s = 1; s <= steps; s++) {
    var cx = x0 + (x1 - x0) * s / steps, cz = z0 + (z1 - z0) * s / steps;
    for (var k = -SWATH / 2 + 0.25; k < SWATH / 2; k += 0.5) {
      var x = cx + rx * k, z = cz + rz * k; total++;
      for (var i = 0; i < FIELDS.length; i++) {
        var f = FIELDS[i], u = (x - f.cx) * f.ux + (z - f.cz) * f.uz + f.len / 2, w = (x - f.cx) * f.wx + (z - f.cz) * f.wz + f.wid / 2;
        if (u < 0 || w < 0 || u >= f.len || w >= f.wid) continue;
        inside++;
        if (now - f.lastHit > 2.5) f.pass = f.pass % 250 + 1;
        f.lastHit = now;
        var ui = u | 0, wi = w | 0, id = ui * f.wid + wi;
        if (f.grid[id] === 0) {
          f.grid[id] = f.pass; f.cov++; f.sw[Math.min(f.nSw - 1, (w / SWATH) | 0)]++;
          f.ctx.fillStyle = 'rgba(16,44,30,0.46)'; f.ctx.fillRect(wi, f.len - 1 - ui, 1, 1); f.dirty = true;
        } else if (f.grid[id] !== f.pass && !f.ovl[id]) {
          f.ovl[id] = 1; f.over++;
          f.ctx.fillStyle = 'rgba(70,20,90,0.35)'; f.ctx.fillRect(wi, f.len - 1 - ui, 1, 1); f.dirty = true;
        }
        break;
      }
    }
  }
  return total ? inside / total : 0;
}

// ===================== colisões =====================
function segSegDist2(p1, q1, p2, q2) {
  var d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z, d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  var rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  var a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  var c = d1x * rx + d1y * ry + d1z * rz, b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
  var s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0, t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
  var x = rx + d1x * s - d2x * t, y = ry + d1y * s - d2y * t, z = rz + d1z * s - d2z * t;
  return x * x + y * y + z * z;
}
