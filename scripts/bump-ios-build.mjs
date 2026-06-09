#!/usr/bin/env node
/**
 * Manuell bump av iOS build-nummer (CURRENT_PROJECT_VERSION) i project.pbxproj.
 * Appflow använder Trapeze + CI_BUILD_NUMBER automatiskt — kör detta bara lokalt vid behov.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PBX = resolve("ios/App/App.xcodeproj/project.pbxproj");
const src = readFileSync(PBX, "utf8");
const matches = [...src.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)];

if (matches.length === 0) {
  console.error("Hittade inget CURRENT_PROJECT_VERSION i project.pbxproj");
  process.exit(1);
}

const current = Math.max(...matches.map((m) => Number(m[1])));
const next = current + 1;
const updated = src.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${next};`);
writeFileSync(PBX, updated, "utf8");
console.log(`iOS build-nummer: ${current} → ${next}`);
