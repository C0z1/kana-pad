// Cuentos N5 de Kana Pad: textos y preguntas propios (MIT).
// script: "hira" = solo hiragana · "kata" = centrado en katakana · "kanji" = con kanji N5.
// En los de kanji, cada palabra con kanji lleva su lectura entre corchetes: 学校[がっこう].
// Cada pregunta: q, a (respuesta correcta según el texto), o (3 opciones incorrectas).
export const STORIES_N5 = [
  {
    id: "tama", script: "hira", title: "ねこの たま",
    text: "わたしの いえに ねこが います。なまえは たまです。たまは しろくて、ちいさい ねこです。あさ、たまは わたしの へやに きて、「にゃあ」と いいます。ごはんは わたしが あげます。ひるは にわで ねます。よるは わたしの ふとんで いっしょに ねます。たまは とても かわいいです。",
    questions: [
      { q: "¿De qué color es Tama?", a: "Blanca", o: ["Negra", "Café", "Gris"] },
      { q: "¿Qué hace Tama a mediodía?", a: "Duerme en el jardín", o: ["Come en la cocina", "Juega en el cuarto", "Sale a pasear a la calle"] },
      { q: "¿Dónde duerme Tama en la noche?", a: "En el futón, con quien narra", o: ["En el jardín", "En la cocina", "Debajo de la mesa"] },
    ],
  },
  {
    id: "umi", script: "hira", title: "にちようび",
    text: "にちようびに ともだちと うみへ いきました。でんしゃで いちじかん かかりました。うみは あおくて、きれいでした。わたしたちは およいだり、すなの うえで ねたり しました。ひるごはんに おにぎりを たべました。とても おいしかったです。かえりの でんしゃで、ともだちは ずっと ねて いました。たのしい いちにちでした。",
    questions: [
      { q: "¿Cómo fueron al mar?", a: "En tren", o: ["En autobús", "En coche", "A pie"] },
      { q: "¿Qué comieron al mediodía?", a: "Onigiri (bolas de arroz)", o: ["Sushi", "Pan", "Ramen"] },
      { q: "¿Qué hizo el amigo en el tren de regreso?", a: "Durmió todo el camino", o: ["Leyó un libro", "Comió dulces", "Habló sin parar"] },
    ],
  },
  {
    id: "tegami", script: "hira", title: "おばあさんの てがみ",
    text: "きのう、おばあさんから てがみが きました。おばあさんは いなかに すんで います。おばあさんは てがみに「げんきですか。こちらは もう さむいです。にわの きの はっぱが あかく なりました。ふゆやすみに あいに きて ください。」と かきました。わたしは すぐ へんじを かきました。「ふゆやすみに かならず いきます。」",
    questions: [
      { q: "¿Dónde vive la abuela?", a: "En el campo", o: ["En Tokio", "Cerca de la escuela", "En la misma casa"] },
      { q: "¿Qué pasó con las hojas del árbol del jardín?", a: "Se pusieron rojas", o: ["Se pusieron verdes", "Crecieron mucho", "Se las llevó el viento"] },
      { q: "¿Qué contesta quien narra?", a: "Que irá en las vacaciones de invierno", o: ["Que no puede ir", "Que irá en verano", "Que la abuela venga a su casa"] },
    ],
  },
  {
    id: "kafe", script: "kata", title: "カフェの メニュー",
    text: "カフェ「ソラ」の メニュー\nコーヒー 300えん\nミルクティー 350えん\nオレンジジュース 280えん\nチーズケーキ 400えん\nチョコレートケーキ 420えん\nサンドイッチ 500えん\nきょうは アンナさんと カフェに きました。アンナさんは コーヒーと チーズケーキを たのみました。わたしは オレンジジュースと サンドイッチです。",
    questions: [
      { q: "¿Cuánto cuesta el café?", a: "300 yenes", o: ["350 yenes", "400 yenes", "500 yenes"] },
      { q: "¿Qué pidió Anna?", a: "Café y tarta de queso", o: ["Té con leche y sándwich", "Jugo de naranja y sándwich", "Café y pastel de chocolate"] },
      { q: "¿Qué es lo más caro del menú?", a: "El sándwich", o: ["El pastel de chocolate", "El té con leche", "La tarta de queso"] },
    ],
  },
  {
    id: "tomu", script: "kata", title: "トムさんの いちにち",
    text: "トムさんは アメリカから きました。まいあさ ジョギングを して、シャワーを あびます。それから パンと コーヒーの あさごはんを たべます。ひるは コンビニで おべんとうを かいます。よるは テレビで サッカーを みます。しゅうまつは ギターを ひきます。",
    questions: [
      { q: "¿De dónde es Tom?", a: "De Estados Unidos", o: ["De Inglaterra", "De Japón", "De Francia"] },
      { q: "¿Qué hace Tom después de correr?", a: "Se ducha", o: ["Toca la guitarra", "Ve fútbol", "Compra el almuerzo"] },
      { q: "¿Dónde compra el almuerzo?", a: "En la tienda de conveniencia", o: ["En un restaurante", "En la escuela", "En la estación"] },
    ],
  },
  {
    id: "depato", script: "kata", title: "デパートで かいもの",
    text: "きのう デパートへ いきました。まず 3がいで シャツと セーターを みました。セーターは 5000えんでした。ちょっと たかかったです。それから 5かいの レストランで カレーライスを たべました。さいごに 1かいで ハンカチを かいました。エレベーターは ひとが とても おおかったです。",
    questions: [
      { q: "¿Cuánto costaba el suéter?", a: "5000 yenes", o: ["3000 yenes", "1000 yenes", "500 yenes"] },
      { q: "¿Qué comió en el restaurante?", a: "Arroz con curry", o: ["Un sándwich", "Sushi", "Pastel"] },
      { q: "¿En qué piso compró el pañuelo?", a: "En el 1.º", o: ["En el 3.º", "En el 5.º", "No compró nada"] },
    ],
  },
  {
    id: "ichinichi", script: "kanji", title: "わたしの 一日[いちにち]",
    text: "わたしは 大学生[だいがくせい]です。毎日[まいにち] 電車[でんしゃ]で 学校[がっこう]へ 行[い]きます。学校[がっこう]は 駅[えき]の 前[まえ]に あります。午前[ごぜん]は 日本語[にほんご]の クラスが あります。午後[ごご]は 友[とも]だちと としょかんで 本[ほん]を 読[よ]みます。六時[ろくじ]に いえに かえります。",
    questions: [
      { q: "¿Cómo va a la escuela?", a: "En tren", o: ["En autobús", "A pie", "En bicicleta"] },
      { q: "¿Qué tiene en la mañana?", a: "Clase de japonés", o: ["Clase de inglés", "Trabajo", "Deporte"] },
      { q: "¿Qué hace en la tarde con sus amigos?", a: "Lee libros en la biblioteca", o: ["Ve películas", "Come en un restaurante", "Juega fútbol"] },
    ],
  },
  {
    id: "yama", script: "kanji", title: "山[やま]へ",
    text: "先週[せんしゅう]の どようび、父[ちち]と 山[やま]へ 行[い]きました。車[くるま]で 二時間[にじかん] かかりました。天気[てんき]が よくて、空[そら]が きれいでした。山[やま]の 上[うえ]は 少[すこ]し さむかったです。川[かわ]の 水[みず]は とても つめたかったです。ひるごはんに 母[はは]の おべんとうを 食[た]べました。",
    questions: [
      { q: "¿Con quién fue a la montaña?", a: "Con su padre", o: ["Con su madre", "Con amigos", "Sin nadie"] },
      { q: "¿Cómo estaba el agua del río?", a: "Muy fría", o: ["Caliente", "Sucia", "No había agua"] },
      { q: "¿Quién preparó el almuerzo?", a: "Su madre", o: ["Su padre", "Quien narra", "Lo compraron en el camino"] },
    ],
  },
  {
    id: "mise", script: "kanji", title: "新[あたら]しい 店[みせ]",
    text: "駅[えき]の 北[きた]に 新[あたら]しい 魚[さかな]の 店[みせ]が あります。先月[せんげつ] できました。きのう、母[はは]と 行[い]きました。店[みせ]の 人[ひと]は とても しんせつでした。魚[さかな]は 安[やす]かったです。母[はは]は 大[おお]きい 魚[さかな]を 二[に]ひき 買[か]いました。ばんごはんに 食[た]べました。とても おいしかったです。",
    questions: [
      { q: "¿Dónde está la tienda?", a: "Al norte de la estación", o: ["Al sur de la estación", "Frente a la escuela", "Junto al río"] },
      { q: "¿Cómo era el pescado?", a: "Barato", o: ["Caro", "Pequeño", "Viejo"] },
      { q: "¿Cuántos pescados compró la madre?", a: "Dos", o: ["Uno", "Tres", "Cinco"] },
    ],
  },
];
