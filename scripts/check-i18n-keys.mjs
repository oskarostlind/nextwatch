#!/usr/bin/env node
// scripts/check-i18n-keys.mjs
//
// Statisk kontroll av att varje t("nyckel") faktiskt finns i messages/sv.json
// och messages/en.json. En saknad nyckel syns annars först som rå nyckeltext i
// gränssnittet, och bara på den sida som råkar rendera den.
//
// Dynamiska nycklar (t(`sort.${x}`)) kan inte slås upp statiskt — deras
// prefix kontrolleras i stället, och de listas så att de kan ögnas igenom.
//
// Kör: node scripts/check-i18n-keys.mjs

import fs from "node:fs";
import path from "node:path";

const sv = JSON.parse(fs.readFileSync("messages/sv.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

const get = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

const files = [];
for (const root of ["app", "lib", "i18n"]) {
  if (!fs.existsSync(root)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  })(root);
}

const missing = [];
const dynamic = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");

  // varName -> namespace
  const ns = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*"([^"]+)"\s*\)/g)) ns[m[1]] = m[2];
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*await\s+getTranslations\(\s*"([^"]+)"\s*\)/g)) ns[m[1]] = m[2];
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*await\s+getTranslations\(\{[^}]*namespace:\s*"([^"]+)"/g)) ns[m[1]] = m[2];
  // namespace via template: `push.${key}` o.dyl. — hoppas över
  if (Object.keys(ns).length === 0) continue;

  for (const [varName, namespace] of Object.entries(ns)) {
    const call = new RegExp(`\\b${varName}(?:\\.rich)?\\(\\s*(?:"([^"]+)"|\`([^\`]+)\`)`, "g");
    for (const m of src.matchAll(call)) {
      const literal = m[1];
      const tpl = m[2];
      if (literal) {
        const full = `${namespace}.${literal}`;
        const inSv = get(sv, full) !== undefined;
        const inEn = get(en, full) !== undefined;
        if (!inSv || !inEn) {
          missing.push(`${file}: ${full}${!inSv ? " [saknas i sv]" : ""}${!inEn ? " [saknas i en]" : ""}`);
        }
      } else if (tpl) {
        const prefix = tpl.split("${")[0].replace(/\.$/, "");
        const full = prefix ? `${namespace}.${prefix}` : namespace;
        const ok = get(sv, full) !== undefined && get(en, full) !== undefined;
        dynamic.push(`${file}: ${namespace}.${tpl}${ok ? "" : "  ⚠ prefix saknas"}`);
      }
    }
  }
}

if (missing.length) {
  console.log(`SAKNADE NYCKLAR (${missing.length}):`);
  for (const m of missing) console.log("  " + m);
} else {
  console.log("Alla statiska nycklar finns i båda språken.");
}
console.log(`\nDynamiska nycklar (kontrollera prefix): ${dynamic.length}`);
for (const d of dynamic) if (d.includes("⚠")) console.log("  " + d);

process.exitCode = missing.length ? 1 : 0;
