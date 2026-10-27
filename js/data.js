const HIRAGANA = "あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro わwa をwo んn"
  .split(" ").map(s => ({ q: s[0], a: s.slice(1) }));

// "palabra|lectura|significado" per line
const triples = text => text.trim().split("\n").map(line => {
  const [q, r, a] = line.trim().split("|");
  return { q, r, a };
});

export const DECKS = [
  { id: "hira", name: "Hiragana", items: HIRAGANA },
  // Katakana sits exactly 0x60 code points after hiragana.
  { id: "kata", name: "Katakana", items: HIRAGANA.map(i => ({ q: String.fromCharCode(i.q.charCodeAt(0) + 0x60), a: i.a })) },
  { id: "vocab", name: "Vocabulario N5", items: triples(`
    私|わたし|yo
    水|みず|agua
    食べる|たべる|comer
    飲む|のむ|beber
    行く|いく|ir
    来る|くる|venir
    見る|みる|ver
    聞く|きく|escuchar
    話す|はなす|hablar
    読む|よむ|leer
    書く|かく|escribir
    買う|かう|comprar
    待つ|まつ|esperar
    寝る|ねる|dormir
    起きる|おきる|despertarse
    大きい|おおきい|grande
    小さい|ちいさい|pequeño
    高い|たかい|caro / alto
    安い|やすい|barato
    新しい|あたらしい|nuevo
    古い|ふるい|viejo (cosas)
    暑い|あつい|caluroso
    寒い|さむい|frío (clima)
    好き|すき|que gusta
    今日|きょう|hoy
    明日|あした|mañana
    昨日|きのう|ayer
    学校|がっこう|escuela
    先生|せんせい|profesor
    学生|がくせい|estudiante
    友達|ともだち|amigo
    家|いえ|casa
    本|ほん|libro
    電車|でんしゃ|tren
    時間|じかん|tiempo / hora
    天気|てんき|clima
    猫|ねこ|gato
    犬|いぬ|perro
    朝ご飯|あさごはん|desayuno
    駅|えき|estación`) },
  { id: "kanji", name: "Kanji", items: triples(`
    一|いち|uno
    二|に|dos
    三|さん|tres
    四|よん|cuatro
    五|ご|cinco
    六|ろく|seis
    七|なな|siete
    八|はち|ocho
    九|きゅう|nueve
    十|じゅう|diez
    日|にち|sol / día
    月|つき|luna / mes
    火|ひ|fuego
    水|みず|agua
    木|き|árbol
    金|かね|oro / dinero
    土|つち|tierra
    人|ひと|persona
    山|やま|montaña
    川|かわ|río
    口|くち|boca
    目|め|ojo
    手|て|mano
    大|だい|grande
    小|しょう|pequeño
    上|うえ|arriba
    下|した|abajo
    中|なか|dentro / centro
    年|とし|año
    学|がく|estudiar`) },
];
