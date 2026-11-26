const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const logo = fs.readFileSync(path.join(__dirname, 'assets', 'scheffer-logo.png'));
const logoJs = "var LOGO_URI = 'data:image/png;base64," + logo.toString('base64') + "', LOGO_ASPECT = " + (logo.readUInt32BE(16) / logo.readUInt32BE(20)).toFixed(3) + ';';
const nalFile = ['naldinho.png', 'naldinho.jpg', 'naldinho.webp'].map(f => path.join(__dirname, 'assets', f)).find(f => fs.existsSync(f));
const nalJs = "var NALDINHO_URI = '" + (nalFile ? 'data:image/' + path.extname(nalFile).slice(1).replace('jpg', 'jpeg') + ';base64,' + fs.readFileSync(nalFile).toString('base64') : '') + "';";
const js = [logoJs, nalJs, src('flight.js'), src('world.js'), src('audio.js'), src('game.js')].join('\n');
new Function('THREE', 'module', js.replace("'use strict';", ''));           // checagem de sintaxe
const tpl = src('template.html');
const out = (three) => tpl.replace('__THREE__', three).replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(__dirname, 'index.html'), out('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'));
console.log('ok', (fs.statSync(path.join(__dirname, 'index.html')).size / 1024).toFixed(0) + ' KB');
