// ===== Som sintetizado: hélice, turbina, escape, vento, aplicação, rolagem, eventos =====
function makeAudio(c) {
  var out = c.createGain(); out.gain.value = 0;
  var comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.008; comp.release.value = 0.25;
  out.connect(comp); comp.connect(c.destination);
  var sr = c.sampleRate, i;
  var mkBuf = function (brown) {
    var n = Math.floor(sr * 3), b = c.createBuffer(1, n, sr), d = b.getChannelData(0), last = 0, w;
    for (i = 0; i < n; i++) { w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  };
  var white = mkBuf(false), brown = mkBuf(true);
  var noise = function (buf, rate) { var s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate || 1; s.start(0); return s; };
  var gain = function (v, dest) { var g = c.createGain(); g.gain.value = v; g.connect(dest || out); return g; };
  var filt = function (type, f, q, dest) { var b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; b.connect(dest); return b; };
  var osc = function (type, f, dest) { var o = c.createOscillator(); if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type); o.frequency.value = f; o.connect(dest); o.start(0); return o; };

  // hélice: passagem de pá rica em harmônicos (é o que o alto-falante do celular reproduz), com batimento entre duas vozes
  var N = 20, re = new Float32Array(N), im = new Float32Array(N);
  for (i = 1; i < N; i++) im[i] = (i % 3 === 0 ? 1.25 : 1) / Math.pow(i, 0.85) * (i > 12 ? 0.5 : 1);
  var wave = c.createPeriodicWave(re, im);
  var propG = gain(0), propLP = filt('lowpass', 600, 0.8, propG), propAM = gain(1, propLP);
  var p1 = osc(wave, 60, propAM), p2 = osc(wave, 60.5, propAM);
  var lfoG = c.createGain(); lfoG.gain.value = 0.16; lfoG.connect(propAM.gain); var lfo = osc('sine', 19, lfoG);
  // escape e fluxo da hélice: ruído grave
  var exhG = gain(0), exhLP = filt('lowpass', 320, 0.6, exhG); noise(brown, 1).connect(exhLP);
  var exh2G = gain(0), exhBP = filt('bandpass', 520, 0.9, exh2G); noise(white, 0.7).connect(exhBP);
  // turbina: apito do compressor mais sopro em volta dele
  var whG = gain(0), w1 = osc('sine', 4200, whG), w2g = gain(0.45, whG), w2 = osc('sine', 6300, w2g);
  var hissG = gain(0), hissBP = filt('bandpass', 4200, 9, hissG); noise(white, 1).connect(hissBP);
  // vento
  var windG = gain(0), windBP = filt('bandpass', 700, 0.5, windG); noise(white, 0.9).connect(windBP);
  var wind2G = gain(0), windLP = filt('lowpass', 260, 0.5, wind2G); noise(brown, 1.3).connect(windLP);
  // aplicação: chiado dos bicos e zumbido da bomba eólica
  var sprG = gain(0), sprHP = filt('highpass', 3400, 0.7, sprG); noise(white, 1.2).connect(sprHP);
  var pumpG = gain(0), pump = osc('triangle', 310, filt('bandpass', 620, 2, pumpG));
  // rolagem na pista de terra
  var rollG = gain(0), rollBP = filt('bandpass', 210, 0.8, rollG); noise(brown, 0.8).connect(rollBP);
  var roll2G = gain(0), roll2 = filt('bandpass', 900, 1.2, roll2G); noise(white, 0.5).connect(roll2);
  // buzina de estol (palheta)
  var hornG = gain(0), hornLP = filt('lowpass', 2600, 0.7, hornG); osc('square', 468, hornLP); osc('square', 502, hornLP);

  // fogo
  var fireG = gain(0), fireBP = filt('bandpass', 620, 0.6, fireG); noise(brown, 1.6).connect(fireBP); var fire2G = gain(0), fire2 = filt('highpass', 2500, 0.7, fire2G); noise(white, 0.4).connect(fire2);
  var set = function (p, v, tc) { p.setTargetAtTime(v, c.currentTime, tc || 0.12); };
  var bump = 0;
  var burst = function (buf, type, f, q, peak, dur, rate) {
    var s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate || 1;
    var g = c.createGain(), t = c.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; s.connect(b); b.connect(g); g.connect(out); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  };
  var tone = function (type, f0, f1, peak, dur) {
    var o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  };
  return {
    ctx: c,
    // s: { on, pow, V, vf, onGround, spraying, stall, cockpit, dt }
    update: function (s) {
      set(out.gain, s.on ? 0.85 : 0, 0.08);
      s.vf = s.vf || 0; s.V = s.V || 0;
      var pw = Math.max(0, Math.min(1, s.pow || 0));
      var live = s.engineOut ? 0 : 1;
      if (s.piston) {                                                      // seis cilindros opostos, hélice bipá, sem redução: a rotação acompanha a manete
        var rpm = 780 + 1770 * Math.pow(pw, 0.6), fb = rpm / 60 * 2, ff = rpm / 60 * 3;   // passagem de pá e frequência de explosão
        set(p1.frequency, fb, 0.18); set(p2.frequency, ff * 1.004, 0.18); set(lfo.frequency, rpm / 60, 0.18); set(lfoG.gain, 0.5 - 0.22 * pw, 0.2);
        set(propLP.frequency, 420 + 1900 * Math.pow(pw, 1.1), 0.2);
        set(propG.gain, live * (0.09 + 0.17 * Math.pow(pw, 0.8)) * (s.cockpit ? 1.15 : 1), s.engineOut ? 0.5 : 0.15);
        set(exhG.gain, live * (0.16 + 0.42 * pw), 0.25); set(exhLP.frequency, 150 + 300 * pw, 0.2);
        set(exh2G.gain, live * (0.03 + 0.09 * pw), 0.25); set(exhBP.frequency, 300 + 380 * pw, 0.2);
      } else {
        set(lfoG.gain, 0.16, 0.2);
      var n = 0.52 + 0.48 * Math.pow(Math.min(1, pw / 0.4), 0.7);          // governador: rotação cheia já em ~40% de torque
        var f0 = 110 * n;                                                    // 2.200 rpm x 3 pás = 110 Hz
        set(p1.frequency, f0, 0.25); set(p2.frequency, f0 * 1.006 + 0.3, 0.25); set(lfo.frequency, f0 / 3, 0.25);
        set(propLP.frequency, 650 + 2900 * Math.pow(pw, 1.1), 0.2);
        set(propG.gain, live * (0.06 + 0.16 * Math.pow(pw, 0.8)) * (s.cockpit ? 1.15 : 1), s.engineOut ? 0.5 : 0.15);
        set(exhG.gain, live * (0.08 + 0.32 * pw), 0.3); set(exhLP.frequency, 220 + 380 * pw, 0.2);
        set(exh2G.gain, live * (0.02 + 0.10 * pw), 0.3); set(exhBP.frequency, 420 + 500 * pw, 0.2);
        var ng = 0.62 + 0.38 * pw, ft = 6100 * ng;                           // rotação do gerador de gases
        set(w1.frequency, ft * 0.7, 0.5); set(w2.frequency, ft, 0.5); set(hissBP.frequency, ft * 0.72, 0.5);
      }
      var near = s.onGround ? 1 : 0.45;                                    // em voo o vento e a hélice encobrem o apito
      var tb = s.piston ? 0 : 1;                                           // motor a pistão não tem apito de turbina
      set(whG.gain, tb * live * 0.034 * near * (1.2 - 0.5 * pw), 0.3); set(hissG.gain, tb * live * 0.26 * near * (1.1 - 0.4 * pw), 0.3);
      var q = Math.min(1.3, s.V * s.V / 4200), wv = s.cockpit ? 0.6 : 1;
      set(windG.gain, 0.11 * q * wv, 0.2); set(windBP.frequency, 480 + s.V * 11, 0.2); set(wind2G.gain, 0.20 * q * wv, 0.2);
      set(sprG.gain, s.spraying ? 0.11 : 0, 0.08); set(pumpG.gain, s.spraying ? 0.05 : 0, 0.1); set(pump.frequency, 180 + s.V * 2.6, 0.2);
      var roll = s.onGround ? Math.min(1, s.vf / 30) : 0;
      bump += (Math.random() - bump) * Math.min(1, (s.dt || 0.016) * 14);
      set(rollG.gain, roll * (0.35 + 0.5 * bump), 0.04); set(roll2G.gain, roll * 0.03 * (0.5 + bump), 0.04); set(rollBP.frequency, 150 + s.vf * 4, 0.1);
      set(hornG.gain, s.stall ? 0.05 : 0, 0.02);
      set(fireG.gain, s.fire ? 0.45 * (0.5 + bump) : 0, 0.06); set(fire2G.gain, s.fire ? 0.05 * bump : 0, 0.03);
    },
    event: function (name, v) {
      if (name === 'touch') { var k = Math.min(1, 0.35 + (v || 0) / 3.6); tone('sine', 150, 55, 0.5 * k, 0.28); burst(brown, 'lowpass', 400, 0.7, 0.9 * k, 0.35, 1); burst(white, 'bandpass', 1900, 5, 0.10 * k, 0.16, 1); }
      else if (name === 'crash') { tone('sine', 180, 40, 0.8, 0.6); burst(brown, 'lowpass', 900, 0.6, 1.4, 1.5, 0.8); burst(white, 'bandpass', 1400, 0.8, 0.35, 0.9, 0.6); }
      else if (name === 'flap') { tone('sawtooth', 240, 205, 0.02, 1.1); burst(white, 'bandpass', 1500, 6, 0.03, 1.1, 1); }
      else if (name === 'valve') { burst(white, 'bandpass', v ? 2600 : 1500, 4, 0.12, 0.09, 1); tone('square', v ? 320 : 230, v ? 300 : 200, 0.03, 0.06); }
      else if (name === 'crunch') { tone('sawtooth', 95, 42, 0.22, 0.4); burst(white, 'bandpass', 850, 1.4, 0.55, 0.5, 0.5); burst(brown, 'lowpass', 500, 0.7, 0.9, 0.4, 1); }
      else if (name === 'tear') { tone('square', 320, 60, 0.10, 0.55); burst(white, 'bandpass', 1700, 1.0, 0.5, 0.7, 0.7); burst(brown, 'lowpass', 600, 0.7, 0.8, 0.35, 1); }
      else if (name === 'bang') { tone('sine', 150, 34, 0.9, 0.45); burst(brown, 'lowpass', 800, 0.7, 1.3, 0.6, 1); burst(white, 'bandpass', 2200, 0.8, 0.25, 0.3, 1); }
      else if (name === 'coin') { tone('triangle', 1250, 1700, 0.045, 0.07); }
      else if (name === 'reward') { tone('triangle', 880, 884, 0.16, 0.16); setTimeout(function () { tone('triangle', v >= 3 ? 1760 : 1320, v >= 3 ? 1765 : 1324, 0.18, 0.32); }, 110); }
      else if (name === 'lift') { burst(brown, 'lowpass', 300, 0.7, 0.25, 0.4, 1); }
    }
  };
}
