// Prints every text the app can say, as { hash: text }, for tools/voices/generate.py.
import { allTexts } from "../../js/clips.js";

process.stdout.write(JSON.stringify(allTexts()));
