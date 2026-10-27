import { VOCAB_N5 } from "./content/vocab-n5.js";
import { KANJI_N5 } from "./content/kanji-n5.js";

const HIRAGANA = "あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa をwo んn"
  .split(" ").map(s => ({ q: s[0], a: s.slice(1) }));

// "frase con ＿|respuesta|distractor,distractor,distractor|traducción|explicación" per line.
// Distractors must be wrong in that sentence, not merely less natural.
const cloze = text => text.trim().split("\n").map(line => {
  const [q, a, o, t, n] = line.trim().split("|");
  return { q, a, o: o.split(","), t, n, r: q.replace("＿", a) };
});

export const DECKS = [
  { id: "hira", name: "Hiragana", kind: "kana", items: HIRAGANA },
  // Katakana sits exactly 0x60 code points after hiragana.
  { id: "kata", name: "Katakana", kind: "kana", items: HIRAGANA.map(i => ({ q: String.fromCharCode(i.q.charCodeAt(0) + 0x60), a: i.a })) },
  { id: "gram5", name: "Gramática N5", kind: "grammar", items: cloze(`
    わたし＿がくせいです。|は|を,で,へ|Yo soy estudiante.|は marca el tema de la oración: «en cuanto a mí…».
    これはわたし＿ほんです。|の|を,で,に|Este es mi libro.|の une dos sustantivos: わたしのほん = «el libro de mí», mi libro.
    まいにちコーヒー＿のみます。|を|に,で,の|Tomo café todos los días.|を marca el objeto directo del verbo: lo que se bebe.
    としょかん＿べんきょうします。|で|を,の,と|Estudio en la biblioteca.|で marca el lugar donde ocurre una acción.
    あした、がっこう＿いきます。|に|を,で,の|Mañana voy a la escuela.|に (o へ) marca el destino de un movimiento.
    ともだち＿えいがをみました。|と|を,へ,で|Vi una película con un amigo.|と significa «con» cuando hablas de compañía.
    へやにねこ＿います。|が|を,で,へ|Hay un gato en el cuarto.|Con います y あります, lo que existe va con が.
    つくえのうえ＿ほんがあります。|に|を,で,へ|Hay un libro sobre el escritorio.|に marca dónde está algo (con あります / います).
    9じ＿おきます。|に|で,を,が|Me levanto a las 9.|Las horas concretas llevan に.
    バス＿がっこうへいきます。|で|を,に,が|Voy a la escuela en autobús.|で marca el medio o instrumento: en autobús, con palillos.
    にほんご＿すこしわかります。|が|を,で,へ|Entiendo un poco de japonés.|わかります lleva が para lo que se entiende, no を.
    すし＿すきです。|が|を,で,に|Me gusta el sushi.|すき y きらい llevan が para lo que gusta.
    えき＿まえでまちます。|の|を,が,に|Espero frente a la estación.|えきのまえ = «el frente de la estación».
    きのうテレビを＿。|みました|みます,みません,みて|Ayer vi la televisión.|Pasado formal: ます → ました.
    ちょっと＿ください。|まって|まちて,まった,まつ|Espere un momento, por favor.|Forma て + ください para pedir algo. まつ → まって.
    ここでしゃしんを＿もいいですか。|とって|とりて,とった,とる|¿Puedo tomar fotos aquí?|Forma て + もいいですか para pedir permiso. とる → とって.
    いま、にほんごをべんきょう＿います。|して|する,した,しって|Ahora estoy estudiando japonés.|Forma て + いる para una acción en curso. する → して.
    このへやは＿です。|しずか|しずかい,しずかな,しずかの|Este cuarto es tranquilo.|Adjetivo な antes de です: sin な.
    ＿へやですね。|きれいな|きれい,きれいい,きれいの|Qué cuarto tan limpio.|Adjetivo な antes de un sustantivo: con な. きれい es adjetivo な aunque termine en い.
    きのうはさむ＿です。|かった|いでした,いだった,かったでした|Ayer hizo frío.|Pasado de adjetivo い: さむい → さむかったです.
    このケーキはあまり＿。|おいしくないです|おいしいじゃないです,おいしくありです,おいしかないです|Este pastel no está muy rico.|Negativo de adjetivo い: い → くないです.
    すしをたべ＿です。|たい|たり,ます,て|Quiero comer sushi.|Raíz ます + たい = «quiero».
    あしたえいがをみ＿か。|ません|ました,て,ろ|¿Vemos una película mañana?|～ませんか es una invitación amable.
    いっしょにひるごはんを＿。|たべましょう|たべました,たべている,たべない|Comamos juntos.|～ましょう = «hagamos…».
    ここでタバコを＿ください。|すわないで|すわなくて,すわないて,すわなく|Por favor, no fume aquí.|Forma ない + で + ください para pedir que no se haga algo.
    にほんにいった＿があります。|こと|とき,まで,より|He ido a Japón.|Pasado corto + ことがある = haber tenido la experiencia.
    ねるまえに、はを＿。|みがきます|みがいます,みがくます,みがきります|Me lavo los dientes antes de dormir.|みがく → みがきます: く pasa a き.
    りんごを＿かいました。|みっつ|さんつ,みつ,さんまい|Compré tres manzanas.|Contador general: ひとつ, ふたつ, みっつ…
    いま＿じです。|よ|し,よん,よっ|Son las 4.|Las 4 en punto se dicen よじ, no よんじ.
    トイレは＿ですか。|どこ|だれ,なに,いつ|¿Dónde está el baño?|どこ = dónde.
    あのひとは＿ですか。|だれ|いくら,いつ,どれ|¿Quién es esa persona?|だれ = quién.
    このかばんは＿ですか。|いくら|だれ,どこ,いつ|¿Cuánto cuesta esta bolsa?|いくら = cuánto cuesta.`) },
  { id: "vocab", name: "Vocabulario N5", kind: "vocab", items: VOCAB_N5 },
  { id: "kanji", name: "Kanji N5", kind: "kanji", items: KANJI_N5 },
];
