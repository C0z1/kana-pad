# Kana Pad

Practica japonés con un mando Xbox: hiragana, katakana, gramática N5, 574 palabras de vocabulario N5 y los 103 kanji N5 con orden de trazos. Está pensado para repasar en el cardio o en las pausas de un juego, y es la primera pieza de un programa de cero a nivel profesional.

**Repaso de hoy** reúne todos los mazos en una sola cola con el algoritmo FSRS: primero lo que toca repasar y después hasta 15 cartas nuevas al día. Los demás mazos son práctica libre. Se instala como app (PWA) desde Chrome o Edge y funciona sin internet.

**Úsalo en línea:** https://c0z1.github.io/kana-pad/

## Controles

| Mando | Teclado | Acción |
| --- | --- | --- |
| A / B / X / Y (o la cruceta) | Flechas | Responder con la opción de ese color |
| LB / RB | Q / E | Mazo anterior o siguiente |
| LT | O | Modo oído: escuchas la palabra sin verla |
| RT | I | Modo inverso: de español o romaji a japonés |
| View | S | Voz en japonés sí o no |
| Menú | Esc | Pausa |

- Cada ronda tiene 10 cartas. Las que fallas vuelven con más frecuencia.
- La app solo escucha el primer mando en el que pulsas un botón. Así puedes dejar otro mando para el juego. "Usar otro mando" (en la pausa) lo reinicia.
- El progreso se guarda en el navegador. Desde la pausa puedes exportarlo o importarlo como JSON.

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
| `content/vocab-n5.txt` | Lista de vocabulario N5 (fuente) |
| `tools/pipeline/` | Genera `js/content/` y valida las lecturas contra JMdict |
| `js/srs.js` | Práctica libre: selección de cartas y opciones |
| `js/scheduler.js` | Repaso diario con FSRS (`js/vendor/ts-fsrs.mjs`, MIT) |
| `js/storage.js` | Guardado en IndexedDB |
| `js/strokes.js` | Animación de trazos con KanjiVG (`content/kanjivg`, CC BY-SA 3.0) |
| `sw.js`, `manifest.webmanifest` | App instalable y sin conexión |
| `js/gamepad.js` | Lectura del mando |
| `js/app.js` | Pantalla y estado |

## Limitaciones conocidas

- El navegador no detecta el mando hasta que pulsas un botón con la página visible.
- Si un juego usa el mismo mando, recibe también tus pulsaciones. Usa un segundo mando o pausa el juego.
- La voz depende de que el sistema tenga una voz en japonés instalada. En Windows: Configuración → Hora e idioma → Voz.

## Licencia

El código es MIT. Los datos de kanji (KANJIDIC2) y los trazos (KanjiVG) son CC BY-SA: el detalle está en [`content/LICENSE-data.md`](content/LICENSE-data.md).
