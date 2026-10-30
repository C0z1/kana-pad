# Kana Pad

Practica japonés con teclado, ratón, pantalla táctil o un mando Xbox: hiragana, katakana y tres niveles JLPT (N5, N4 y N3) con unas 3,000 palabras, 613 kanji con orden de trazos y gramática de cada nivel. Está pensado para repasar en el cardio o en las pausas de un juego, y es la primera pieza de un programa de cero a nivel profesional.

Una **prueba de nivel** (unas preguntas de kana, N5, N4 y N3) decide desde dónde entran cartas nuevas a tu repaso; se puede repetir o cambiar en Ajustes. Incluye **listening** con tres voces japonesas incluidas (funcionan sin conexión), **cuentos** N5, **dibujo** de kana y kanji con calificación por trazo, un **panel de progreso** con logros, **retos** (reto del día, contrarreloj, supervivencia) y **simulacros** N5, N4 y N3.

**Repaso de hoy** reúne todos los mazos en una sola cola con el algoritmo FSRS: primero lo que toca repasar y después hasta 15 cartas nuevas al día. Los demás mazos son práctica libre: cada carta nueva se enseña con su respuesta antes de preguntarla, y entran de una en una a medida que aprendes las anteriores. Se instala como app (PWA) desde Chrome o Edge y funciona sin internet.

**Úsalo en línea:** https://c0z1.github.io/kana-pad/

[Política de privacidad](https://c0z1.github.io/kana-pad/privacidad.html)

## Novedades de 0.11.0

- **Tarjetas mnemotécnicas**: los 17 kanji de N5 que son dibujos (火 fuego, 木 árbol, 日 sol, 水 agua, 山 montaña, 川 río, 月 luna, 雨 lluvia, 空 cielo, 電 electricidad, 人 persona, 口 boca, 目 ojo, 金 oro, 花 flor, 魚 pez, 本 libro) se enseñan con una ilustración de lo que representan: la figura en el centro, los trazos del kanji en negro encima, dibujándose en orden, y el significado debajo.
- **Orden de trazos numerado**: después de responder un kanji, sus trazos se dibujan uno a uno y el número de cada trazo aparece donde empieza, como en una hoja de caligrafía. Los números y su posición vienen de KanjiVG.
- **NUEVO** en el menú: Mis errores e Importar de Anki llevan una etiqueta y un borde que late hasta que los abres una vez.

## Novedades de 0.10.0

- **Mis errores** (Practicar): las cartas que más fallas, de todos los mazos. Una carta sale de la lista sola cuando la aciertas lo suficiente (menos de 25% de fallos). No cambia tu calendario.
- **Tu semana** (Mi panel → Resumen): respuestas, días con estudio, cartas nuevas y retención de los últimos 7 días, comparados con los 7 anteriores, y tu mejor día.
- **Racha protegida**: un día sin estudiar por semana (de lunes a domingo) no rompe tu racha; ese día no suma, pero la racha sigue. Dos días seguidos sí la rompen. Los logros de racha usan la misma regla.
- **Puente con Anki** (Ajustes → Importar de Anki): practica tus mazos de Anki como práctica libre. El primer campo de cada nota es la pregunta y el segundo la respuesta. Solo lee; tu Anki no cambia.
- Movimiento: las tarjetas se elevan al pasar el ratón, los botones se hunden al pulsar, las tarjetas entran escalonadas, las cifras del Resumen cuentan desde cero, el anillo de foco aparece suave y el aviso de ¡LOGRO! se abre como un sobre. Todo se apaga si tu sistema pide reducir el movimiento.

### Cómo conectar Anki

1. En Anki: Herramientas → Complementos → Obtener complementos, código `2055492159` (AnkiConnect). Reinicia Anki.
2. Herramientas → Complementos → AnkiConnect → Configuración: agrega el sitio desde el que abres Kana Pad a `webCorsOriginList`, por ejemplo `"https://c0z1.github.io"` o `"http://localhost:3000"`.
3. Con Anki abierto, en Kana Pad: Ajustes → Importar de Anki y elige un mazo. Chrome puede pedir permiso para conectarse a dispositivos de tu red local: acéptalo.

Los mazos importados se guardan en el navegador (no entran en Exportar ni en la sincronización). Para traer cambios de Anki, vuelve a importar el mazo.

## Descargas

En [Releases](https://github.com/C0z1/kana-pad/releases/latest):

| Sistema | Archivo | Notas |
| --- | --- | --- |
| Windows | `.msi` o `-setup.exe` | El instalador no está firmado: si Windows SmartScreen avisa, elige "Más información" → "Ejecutar de todas formas" |
| Linux | `.AppImage` o `.deb` | Al `.AppImage` dale permiso de ejecución (`chmod +x`) |
| Android | `kana-pad-android.apk` | Versión de prueba firmada con clave de depuración. Permite "instalar apps de origen desconocido". Conecta el mando por Bluetooth |

Las versiones descargables todavía no se actualizan solas: para pasar a una versión nueva, exporta tu progreso (Ajustes → Exportar), instala la nueva e impórtalo. Traen las voces dentro, por eso pesan unos 75 MB. Las apps de escritorio y Android usan el mismo código que la versión web. El progreso de cada una es independiente: para pasarlo de un dispositivo a otro, entra con la misma cuenta (Mi panel → Cuenta) o usa Exportar e Importar en Ajustes.

## Controles

| Mando | Teclado | Acción |
| --- | --- | --- |
| A / B / X / Y (o la cruceta) | Flechas | Responder con la opción de ese color |
| LB / RB | Q / E | Mazo anterior o siguiente |
| LT | O | Modo oído: escuchas la palabra sin verla |
| RT | I | Modo inverso: de español o romaji a japonés |
| View | S | Voz en japonés sí o no |
| Menú | Esc | Pausa |
| B | Esc o ← | Volver (también el botón ← de cada pantalla; ⌂ lleva al inicio) |

- Cada ronda tiene 10 cartas. Las que fallas vuelven con más frecuencia.
- La app solo escucha el primer mando en el que pulsas un botón. Así puedes dejar otro mando para el juego. "Usar otro mando" (en la pausa) lo reinicia.
- El progreso se guarda en el navegador. En Ajustes puedes exportarlo o importarlo como JSON.
- El mando es opcional: con ratón o pantalla táctil, toca la respuesta; las indicaciones del mando aparecen cuando conectas uno.

## Desarrollo

No necesita compilación: HTML, CSS y módulos JavaScript.

```sh
npm start   # servidor local en http://localhost:3000
npm test    # pruebas de la lógica de repaso y de los mazos
npm run content   # regenera js/content desde content/ (descarga JMdict y KANJIDIC2 la primera vez)
```

| Archivo | Contenido |
| --- | --- |
| `js/data.js` | Mazos |
| `content/vocab-n5.txt`, `-n4`, `-n3` | Listas de vocabulario, kanji y gramática por nivel (fuente) |
| `js/placement.js` | Prueba de nivel y punto de partida |
| `tools/pipeline/` | Genera `js/content/` y valida las lecturas contra JMdict |
| `js/srs.js` | Práctica libre: selección de cartas y opciones |
| `js/scheduler.js` | Repaso diario con FSRS (`js/vendor/ts-fsrs.mjs`, MIT) |
| `js/storage.js` | Guardado en IndexedDB |
| `js/strokes.js` | Animación de trazos con KanjiVG (`content/kanjivg`, CC BY-SA 3.0) |
| `sw.js`, `manifest.webmanifest` | App instalable y sin conexión |
| `js/gamepad.js` | Lectura del mando |
| `js/voices.js`, `audio/` | Voces japonesas incluidas (Kokoro-82M, Apache 2.0) |
| `js/app.js` | Pantalla y estado |

### Voces incluidas

La app trae tres voces japonesas (Alpha, Kumo y Gongitsune) en `audio/`, generadas sin conexión con [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0). Funcionan en cualquier sistema, también en Android y Linux, donde no suele haber voz japonesa. Si el sistema tiene más voces japonesas, aparecen junto a ellas en Ajustes → Voces del listening.

Después de cambiar el contenido, genera los audios que falten (`npm test` avisa si faltan):

```sh
py -3.12 -m venv tools/.cache/voices-venv
tools/.cache/voices-venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
tools/.cache/voices-venv/Scripts/python -m pip install kokoro pyopenjtalk-plus fugashi jaconv mojimoji unidic-lite soundfile
node tools/voices/texts.mjs > tools/.cache/texts.json
tools/.cache/voices-venv/Scripts/python tools/voices/generate.py tools/.cache/texts.json
```

## Limitaciones conocidas

- El navegador no detecta el mando hasta que pulsas un botón con la página visible.
- Si un juego usa el mismo mando, recibe también tus pulsaciones. Usa un segundo mando o pausa el juego.
- Las voces incluidas solo dicen el contenido de la app. Si añades contenido sin regenerar el audio, esa frase usa la voz japonesa del sistema, si hay una.

## Licencia

El código es MIT. Los datos de kanji (KANJIDIC2) y los trazos (KanjiVG) son CC BY-SA: el detalle está en [`content/LICENSE-data.md`](content/LICENSE-data.md).
