# Voo Agrícola

Jogo 3D de aviação agrícola para navegador, feito para o iPhone em paisagem. Turboélice agrícola com desempenho baseado no AT-502B, dois talhões de soja, pista de terra, quebra-vento e rede elétrica.

Jogar: https://giisampaio.github.io/voo-agricola/

## Controles

- Inclinação do iPhone com calibragem (exige https e Safari), ou manche na tela.
- Manete de potência, flape em três posições, botão de aplicação, câmera externa e de cabine.
- Teclado, para testar no computador: setas, W/S potência, espaço aplica, F flape, C câmera, P pausa.

## Código

- `src/flight.js`: modelo de voo.
- `src/world.js`: cenário, avião, névoa e cobertura.
- `src/audio.js`: som sintetizado.
- `src/game.js`: entradas, HUD e laço principal.
- `src/template.html`: página e estilos.

`node build.js` junta tudo em `index.html`, que é o arquivo servido pelo GitHub Pages. A única dependência externa é o three.js r128, carregado do cdnjs.
