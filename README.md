# Kana Pad

Practica japonés con un mando Xbox: hiragana, katakana, vocabulario N5 y kanji básicos. Está pensado para repasar en el cardio o en las pausas de un juego.

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
```

| Archivo | Contenido |
| --- | --- |
| `js/data.js` | Mazos |
| `js/srs.js` | Selección de cartas y opciones |
| `js/gamepad.js` | Lectura del mando |
| `js/app.js` | Pantalla y estado |

## Limitaciones conocidas

- El navegador no detecta el mando hasta que pulsas un botón con la página visible.
- Si un juego usa el mismo mando, recibe también tus pulsaciones. Usa un segundo mando o pausa el juego.
- La voz depende de que el sistema tenga una voz en japonés instalada. En Windows: Configuración → Hora e idioma → Voz.

## Licencia

MIT
