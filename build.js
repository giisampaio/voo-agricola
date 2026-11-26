const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const js = [src('flight.js'), src('world.js'), src('audio.js'), src('game.js')].join('\n');
new Function('THREE', 'module', js.replace("'use strict';", ''));           // checagem de sintaxe
const tpl = src('template.html');
const out = (three) => tpl.replace('__THREE__', three).replace('/*__JS__*/', () => js);
fs.writeFileSync(path.join(__dirname, 'index.html'), out('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'));
console.log('ok', (fs.statSync(path.join(__dirname, 'index.html')).size / 1024).toFixed(0) + ' KB');
