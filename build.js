const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const logo = fs.readFileSync(path.join(__dirname, 'assets', 'scheffer-logo.png'));
const logoJs = "var LOGO_URI = 'data:image/png;base64," + logo.toString('base64') + "', LOGO_ASPECT = " + (logo.readUInt32BE(16) / logo.readUInt32BE(20)).toFixed(3) + ';';
const faces = { nal: 'naldinho.webp', feliz: 'eliseu-feliz.webp', bravo: 'eliseu-bravo.webp', maroto: 'eliseu-maroto.webp' }, faceUris = {};
Object.keys(faces).forEach(k => { const f = path.join(__dirname, 'assets', faces[k]); if (fs.existsSync(f)) faceUris[k] = 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64'); });
const nalJs = 'var FACES = ' + JSON.stringify(faceUris) + ';';
const js = [logoJs, nalJs, src('flight.js'), src('world.js'), src('audio.js'), src('game.js')].join('\n');
new Function('THREE', 'module', js.replace("'use strict';", ''));           // checagem de sintaxe
const tpl = src('template.html');
const out = (three) => tpl.replace('__THREE__', three).replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(__dirname, 'index.html'), out('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'));
console.log('ok', (fs.statSync(path.join(__dirname, 'index.html')).size / 1024).toFixed(0) + ' KB');
