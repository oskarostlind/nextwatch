// lib/imdbImport.ts
//
// Parser för IMDb CSV-export (post-2018-format). Stödjer både UTF-8 och
// windows-1252 (vanligt i IMDb-export sedan ~2018).

export type ImdbImportMode = "ratings" | "watchlist";

export type ImdbParsedRow = {
  imdbId: string;
  title: string;
  titleType: string;
  mediaType: "movie" | "tv";
  rating?: number;
};

export type ImdbParseResult = {
  rows: ImdbParsedRow[];
  skipped: number;
};

/** Enkel CSV-rad-parser (hanterar quoted fields). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function mapMediaType(titleType: string): "movie" | "tv" | null {
  const t = titleType.trim().toLowerCase();
  if (t === "movie" || t === "tvmovie" || t === "tv movie") return "movie";
  if (t === "tvseries" || t === "tv series" || t === "tvminiseries" || t === "tv mini series") {
    return "tv";
  }
  return null;
}

function decodeCsvText(buffer: ArrayBuffer): string {
  // Prova UTF-8 först (modern export), fall tillbaka till windows-1252.
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  return new TextDecoder("windows-1252").decode(buffer);
}

export function parseImdbCsv(buffer: ArrayBuffer, mode: ImdbImportMode): ImdbParseResult {
  const text = decodeCsvText(buffer);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], skipped: 0 };

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const idxConst = headers.findIndex((h) => h === "const");
  const idxTitle = headers.findIndex((h) => h === "title");
  const idxType = headers.findIndex((h) => h === "title type");
  const idxRating = headers.findIndex((h) => h === "your rating" || h === "you rated");

  if (idxConst < 0) return { rows: [], skipped: lines.length - 1 };

  const rows: ImdbParsedRow[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const imdbId = (cols[idxConst] ?? "").trim();
    if (!/^tt\d+$/i.test(imdbId)) {
      skipped++;
      continue;
    }

    const titleType = idxType >= 0 ? (cols[idxType] ?? "").trim() : "movie";
    const mediaType = mapMediaType(titleType);
    if (!mediaType) {
      skipped++;
      continue;
    }

    let rating: number | undefined;
    if (mode === "ratings" && idxRating >= 0) {
      const r = Number.parseInt((cols[idxRating] ?? "").trim(), 10);
      if (!Number.isFinite(r) || r < 1 || r > 10) {
        skipped++;
        continue;
      }
      rating = r;
    }

    rows.push({
      imdbId: imdbId.toLowerCase(),
      title: idxTitle >= 0 ? (cols[idxTitle] ?? "").trim() : imdbId,
      titleType,
      mediaType,
      rating,
    });
  }

  return { rows, skipped };
}
