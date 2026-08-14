#!/usr/bin/env node
// scripts/apply-i18n.mjs
//
// Engångsverktyg som användes för att flytta hårdkodad svensk copy till
// messages/sv.json + messages/en.json. Det ersätter strängar i tre lägen:
//
//   1. JSX-textnod        >Spara<              -> >{t("save")}<
//   2. JSX-attribut       placeholder="Sök"    -> placeholder={t("search")}
//   3. JS-uttryck         setMsg("Sparat!")    -> setMsg(t("saved"))
//
// Kör: node scripts/apply-i18n.mjs <map.json> [--dry]
// Kartan har formen:
//   { "app/foo.tsx": { "ns": "foo", "strings": { "Spara": "save" } } }
//
// Verktyget rapporterar strängar som INTE hittades, så att kartan kan rättas
// i stället för att en översättning tyst faller bort.

import fs from "node:fs";
import path from "node:path";

const [, , mapPath, ...flags] = process.argv;
const dry = flags.includes("--dry");
if (!mapPath) {
  console.error("Usage: node scripts/apply-i18n.mjs <map.json> [--dry]");
  process.exit(1);
}

const root = process.cwd();
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let totalReplaced = 0;
const missing = [];

for (const [file, spec] of Object.entries(map)) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    missing.push(`${file}: FILE NOT FOUND`);
    continue;
  }
  let src = fs.readFileSync(abs, "utf8");
  const hookVar = spec.hook ?? "t";

  // Kommentarer maskeras bort under ersättningen och läggs tillbaka efteråt.
  // Utan det skrevs förklarande kommentarer sönder ("Inbjuden"-chippen blev
  // t("invited")-chippen) — kommentarerna är dokumentation, inte copy.
  const masked = [];
  const sentinel = (i) => ` NWCOMMENT${i}NWEND `;
  src = src.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])(\/\/[^\n]*)/gm, (m, lead, lineComment) => {
    if (lineComment === undefined) {
      masked.push(m);
      return sentinel(masked.length - 1);
    }
    masked.push(lineComment);
    return `${lead}${sentinel(masked.length - 1)}`;
  });

  // Längsta strängen först: annars kan "Spara" träffa inuti "Spara ändringar".
  const entries = Object.entries(spec.strings).sort((a, b) => b[0].length - a[0].length);

  for (const [text, key] of entries) {
    const call = `${hookVar}("${key}")`;
    let hits = 0;
    const lit = escapeRe(text);

    // 2) JSX-attribut: name="text" / name='text'.
    //    Kräver att = står HÅRT mot både attributnamn och värde. Utan det
    //    kravet matchade regeln även vanliga tilldelningar (`const m = "text"`)
    //    och skrev in JSX-klammer mitt i ren JavaScript.
    src = src.replace(new RegExp(`([A-Za-z_$][\\w$:.-]*)="${lit}"`, "g"), (_m, name) => {
      hits++;
      return `${name}={${call}}`;
    });
    src = src.replace(new RegExp(`([A-Za-z_$][\\w$:.-]*)='${lit}'`, "g"), (_m, name) => {
      hits++;
      return `${name}={${call}}`;
    });

    // 3) JS-strängliteral i uttrycksläge (allt annat citerat)
    src = src.replace(new RegExp(`"${lit}"`, "g"), () => {
      hits++;
      return call;
    });
    src = src.replace(new RegExp(`'${lit}'`, "g"), () => {
      hits++;
      return call;
    });

    // 1) JSX-textnod. Whitespace inuti texten normaliseras till \s+ eftersom
    //    JSX bryter långa meningar över flera rader med indrag — annars hade
    //    varje ombruten mening behövt matchas tecken för tecken.
    const flexible = text
      .trim()
      .split(/\s+/)
      .map(escapeRe)
      .join("\\s+");
    src = src.replace(new RegExp(`>(\\s*)${flexible}(\\s*)<`, "g"), (_m, a, b) => {
      hits++;
      return `>${a}{${call}}${b}<`;
    });

    // Redan inbäddad i ett uttryck: {"text"} -> {t("key")} städas av 3) ovan.

    if (hits === 0) missing.push(`${file}: ${JSON.stringify(text)}`);
    totalReplaced += hits;
  }

  // Lägg tillbaka kommentarerna exakt som de såg ut.
  src = src.replace(/ NWCOMMENT(\d+)NWEND /g, (_m, i) => masked[Number(i)]);

  if (!dry) fs.writeFileSync(abs, src);
}

console.log(`Replaced ${totalReplaced} occurrence(s)${dry ? " (dry run)" : ""}.`);
if (missing.length) {
  console.log(`\nNOT FOUND (${missing.length}):`);
  for (const m of missing) console.log("  " + m);
  process.exitCode = 2;
}
