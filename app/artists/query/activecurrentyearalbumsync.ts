import artists from "app/repositories/artists/artists";
import {db} from "app/repositories/db";
import {getHtml, isMissingArticlePage} from "app/clients/wikipedia";
import {getAlbumReleaseFromApi} from "app/clients/wikipediaapi";
import * as cheerio from "cheerio";
import {DBArtist} from "app/artists/artist";
import * as fs from "fs";

type AlbumCandidate = {
    albumName: string;
    albumWikilink: string;
    year: number;
    sourceType: "table" | "list";
};

export async function artistsActiveCurrentYearAlbumSync(yearArg?: string, outputFileArg?: string): Promise<void> {
    const targetYear = parseYearOrCurrent(yearArg);
    if (!targetYear) {
        console.log(`[artists.active.current_year.albums.sync] invalid year "${yearArg}". example: artists.active.current_year.albums.sync 2026`);
        return;
    }

    const allArtists = await artists.getAll();
    const activeArtists = allArtists.filter((artist) => artist.year_start !== null && artist.year_start !== undefined && !artist.year_end);
    console.log(`[artists.active.current_year.albums.sync] target_year=${targetYear} active_artists=${activeArtists.length}`);
    console.log("[artists.active.current_year.albums.sync] status=started");

    let scanned = 0;
    let albumsFound = 0;
    let alreadyPresent = 0;
    let wouldInsert = 0;
    let unresolved = 0;
    let errors = 0;
    const outputFile = (outputFileArg || "").trim();
    const reportRows: Array<{
        artistName: string;
        sourcePage: string;
        albumName: string;
        listedLink: string;
        suggestedLink: string;
        status: "would_insert" | "unable_to_infer";
        sourceType: "table" | "list";
    }> = [];
    if (outputFile) {
        fs.appendFileSync(outputFile, `\n=== Run: artists.active.current_year.albums.sync year=${targetYear} ===\n\n`, "utf8");
    }

    for (const artist of activeArtists) {
        scanned += 1;
        console.log(`[artists.active.current_year.albums.sync] progress=${scanned}/${activeArtists.length} artist=${artist.artistname} url=${artist.wikilink}`);
        try {
            const sourcePage = await resolveDiscographyOrArtistSource(artist);
            const html = await getHtml(sourcePage);
            const candidates = extractCurrentYearAlbumCandidates(html, targetYear);
            if (candidates.length === 0) {
                if (scanned % 50 === 0) {
                    console.log(
                        `[artists.active.current_year.albums.sync] heartbeat scanned=${scanned}/${activeArtists.length} albums_found=${albumsFound} already_present=${alreadyPresent} would_insert=${wouldInsert} unresolved=${unresolved} errors=${errors}`,
                    );
                }
                continue;
            }

            const unique = dedupeCandidates(candidates);
            albumsFound += unique.length;
            console.log(
                `[artists.active.current_year.albums.sync] artist=${artist.artistname} source=${sourcePage} current_year_candidates=${unique.length}`,
            );

            for (const candidate of unique) {
                const existing = await findExistingRelease(artist, candidate, targetYear);
                if (existing) {
                    alreadyPresent += 1;
                    continue;
                }

                let albumWikilink = candidate.albumWikilink;
                if (!albumWikilink) {
                    albumWikilink = await inferAlbumWikilink(artist, candidate.albumName, targetYear);
                }
                if (!albumWikilink) {
                    unresolved += 1;
                    reportRows.push({
                        artistName: artist.artistname,
                        sourcePage,
                        albumName: candidate.albumName,
                        listedLink: candidate.albumWikilink,
                        suggestedLink: "",
                        status: "unable_to_infer",
                        sourceType: candidate.sourceType,
                    });
                    if (outputFile) {
                        fs.appendFileSync(outputFile, formatReportRow(reportRows[reportRows.length - 1]), "utf8");
                    }
                    continue;
                }

                wouldInsert += 1;
                reportRows.push({
                    artistName: artist.artistname,
                    sourcePage,
                    albumName: candidate.albumName,
                    listedLink: candidate.albumWikilink,
                    suggestedLink: albumWikilink,
                    status: "would_insert",
                    sourceType: candidate.sourceType,
                });
                if (outputFile) {
                    fs.appendFileSync(outputFile, formatReportRow(reportRows[reportRows.length - 1]), "utf8");
                }
            }
            if (scanned % 25 === 0) {
                console.log(
                    `[artists.active.current_year.albums.sync] heartbeat scanned=${scanned}/${activeArtists.length} albums_found=${albumsFound} already_present=${alreadyPresent} would_insert=${wouldInsert} unresolved=${unresolved} errors=${errors}`,
                );
            }
        } catch (e) {
            errors += 1;
            const message = e instanceof Error ? e.message : String(e);
            console.log(`[artists.active.current_year.albums.sync] error artist=${artist.artistname} url=${artist.wikilink} message=${message}`);
        }
    }

    if (reportRows.length > 0) {
        const formattedReport = formatReport(reportRows);
        if (outputFile) {
            console.log(`[artists.active.current_year.albums.sync] appended report rows to ${outputFile}`);
        } else {
            console.log("");
            console.log(formattedReport);
        }
    }

    console.log(
        `[artists.active.current_year.albums.sync] complete scanned=${scanned} albums_found=${albumsFound} already_present=${alreadyPresent} would_insert=${wouldInsert} unresolved_links=${unresolved} errors=${errors}`,
    );
    console.log("[artists.active.current_year.albums.sync] status=finished");
}

function formatReportRow(row: {
    artistName: string;
    sourcePage: string;
    albumName: string;
    listedLink: string;
    suggestedLink: string;
    status: "would_insert" | "unable_to_infer";
    sourceType: "table" | "list";
}): string {
    const lines: string[] = [];
    lines.push(`Artist: ${row.artistName}`);
    lines.push(`Album: ${row.albumName}`);
    lines.push(`Source Page: ${row.sourcePage}`);
    lines.push(`Detected From: ${row.sourceType}`);
    lines.push(`Listed Wikilink: ${row.listedLink || "(unlinked)"}`);
    lines.push(`Suggested Wikilink: ${row.suggestedLink || "(none)"}`);
    lines.push(`Status: ${row.status}`);
    lines.push("");
    return `${lines.join("\n")}\n`;
}

function formatReport(rows: Array<{
    artistName: string;
    sourcePage: string;
    albumName: string;
    listedLink: string;
    suggestedLink: string;
    status: "would_insert" | "unable_to_infer";
    sourceType: "table" | "list";
}>): string {
    const lines: string[] = [];
    lines.push("=== Active Artist Current-Year Album Candidates ===");
    lines.push("");
    for (const row of rows) {
        lines.push(`Artist: ${row.artistName}`);
        lines.push(`Album: ${row.albumName}`);
        lines.push(`Source Page: ${row.sourcePage}`);
        lines.push(`Detected From: ${row.sourceType}`);
        lines.push(`Listed Wikilink: ${row.listedLink || "(unlinked)"}`);
        lines.push(`Suggested Wikilink: ${row.suggestedLink || "(none)"}`);
        lines.push(`Status: ${row.status}`);
        lines.push("");
    }
    return lines.join("\n");
}

function parseYearOrCurrent(yearArg?: string): number | null {
    if (!yearArg) {
        return new Date().getFullYear();
    }
    const parsed = parseInt(yearArg, 10);
    if (Number.isNaN(parsed) || parsed < 1900 || parsed > 2100) {
        return null;
    }
    return parsed;
}

async function resolveDiscographyOrArtistSource(artist: DBArtist): Promise<string> {
    const candidates = [
        (artist.discography_wikilink || "").trim(),
        `${artist.wikilink}_discography`,
        artist.wikilink,
    ].filter((value, index, arr) => !!value && arr.indexOf(value) === index);

    for (const candidate of candidates) {
        if (!(await isMissingArticlePage(candidate))) {
            return candidate;
        }
    }

    return artist.wikilink;
}

function extractCurrentYearAlbumCandidates(html: string, targetYear: number): AlbumCandidate[] {
    const $ = cheerio.load(html);
    const out: AlbumCandidate[] = [];
    const root = $("#mw-content-text .mw-parser-output").first();
    const scope = root.length ? root : $("body").first();
    let inAlbumSection = false;

    scope.children().each((_, node) => {
        const el = $(node);
        if (el.is("h1,h2,h3,h4,h5,h6")) {
            const heading = normalizeText(el.text()).toLowerCase();
            const isAlbumSection = /discography|album|studio albums|albums/.test(heading)
                && !/single|video|film|references|notes|external links|awards|accolades/.test(heading);
            inAlbumSection = isAlbumSection;
            return;
        }
        if (!inAlbumSection) {
            return;
        }

        el.find("table.wikitable").addBack("table.wikitable").each((__, tableEl) => {
            const table = $(tableEl);
            const rows = table.find("tr");
            if (rows.length < 2) {
                return;
            }
            const headerCells = rows.first().children("th,td");
            const headerLabels = headerCells.toArray().map((cell) => normalizeText($(cell).text()).toLowerCase());
            const albumIndex = findColumnIndex(headerLabels, ["title", "album"]);
            const yearIndex = findColumnIndex(headerLabels, ["year", "released", "release"]);
            if (albumIndex < 0) {
                return;
            }

            rows.each((rowIndex, rowEl) => {
                if (rowIndex === 0) {
                    return;
                }
                const cells = $(rowEl).children("th,td");
                if (cells.length < 2) {
                    return;
                }

                const albumCell = cells.eq(Math.min(albumIndex, cells.length - 1));
                const rowText = normalizeText(cells.text());
                const inferredYear = yearIndex >= 0 && yearIndex < cells.length
                    ? parseYearFromText(cells.eq(yearIndex).text()) || parseYearFromText(rowText)
                    : parseYearFromText(rowText);
                if (inferredYear !== targetYear) {
                    return;
                }

                const albumName = normalizeText(albumCell.text());
                if (!albumName || !isLikelyAlbumName(albumName)) {
                    return;
                }

                const href = albumCell.find('a[href^="/wiki/"]').first().attr("href") || "";
                const albumWikilink = normalizeWikiHref(href);
                out.push({
                    albumName,
                    albumWikilink,
                    year: inferredYear,
                    sourceType: "table",
                });
            });
        });

        if (el.is("ul")) {
            el.children("li").each((__, liEl) => {
                const li = $(liEl);
                const text = normalizeText(li.text());
                const parsed = parseListAlbumWithYear(text);
                if (!parsed || parsed.year !== targetYear) {
                    return;
                }

                const href = li.find('a[href^="/wiki/"]').first().attr("href") || "";
                const albumWikilink = normalizeWikiHref(href);
                out.push({
                    albumName: parsed.albumName,
                    albumWikilink,
                    year: parsed.year,
                    sourceType: "list",
                });
            });
        }
    });

    return out;
}

function dedupeCandidates(candidates: AlbumCandidate[]): AlbumCandidate[] {
    const seen = new Set<string>();
    const out: AlbumCandidate[] = [];
    for (const candidate of candidates) {
        const key = `${normalizeKey(candidate.albumName)}|${normalizeKey(candidate.albumWikilink)}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(candidate);
    }
    return out;
}

function findColumnIndex(labels: string[], candidates: string[]): number {
    for (let i = 0; i < labels.length; i++) {
        if (candidates.some((candidate) => labels[i].includes(candidate))) {
            return i;
        }
    }
    return -1;
}

function parseYearFromText(value: string): number | null {
    const match = normalizeText(value).match(/\b(19|20)\d{2}\b/);
    if (!match) {
        return null;
    }
    const year = parseInt(match[0], 10);
    return Number.isNaN(year) ? null : year;
}

function parseListAlbumWithYear(value: string): { albumName: string; year: number } | null {
    const normalized = normalizeText(value);
    const match = normalized.match(/^(.+?)\s*\((19|20)\d{2}\)\s*$/);
    if (!match) {
        return null;
    }
    const albumName = normalizeText(match[1] || "");
    const year = parseInt((match[0].match(/\b(19|20)\d{2}\b/) || [""])[0], 10);
    if (!albumName || Number.isNaN(year)) {
        return null;
    }
    return { albumName, year };
}

function isLikelyAlbumName(value: string): boolean {
    const normalized = value.toLowerCase();
    return !/(single|chart|label|released|format|sales|certification)/.test(normalized);
}

function normalizeText(value: string): string {
    return (value || "")
        .replace(/\[[0-9]+\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeKey(value: string): string {
    return normalizeText(value)
        .toLowerCase()
        .replace(/['’"]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function normalizeWikiHref(href: string): string {
    if (!href || !href.startsWith("/wiki/")) {
        return "";
    }
    if (href.includes(":") || href.includes("#")) {
        return "";
    }
    return `https://en.wikipedia.org${href}`;
}

async function findExistingRelease(artist: DBArtist, candidate: AlbumCandidate, targetYear: number): Promise<boolean> {
    if (candidate.albumWikilink) {
        const rows: Array<{ id: number }> = await db`
            select id
            from releases
            where lower(wikilink) = lower(${candidate.albumWikilink})
            limit 1
        `;
        if (rows.length > 0) {
            return true;
        }
    }

    const rows: Array<{ id: number }> = await db`
        select id
        from releases
        where dateyear = ${targetYear}
          and (
            lower(coalesce(artist_wikilink, '')) = lower(${artist.wikilink})
            or lower(coalesce(artist_name, '')) = lower(${artist.artistname})
            or lower(coalesce(artist_display_name, '')) = lower(${artist.artistname})
          )
          and (
            lower(coalesce(title, '')) = lower(${candidate.albumName})
            or lower(coalesce(original_title, '')) = lower(${candidate.albumName})
          )
        limit 1
    `;
    return rows.length > 0;
}

async function inferAlbumWikilink(artist: DBArtist, albumName: string, targetYear: number): Promise<string> {
    const searchTerms = [
        `${albumName} ${artist.artistname} album`,
        `${albumName} ${artist.artistname}`,
    ];

    for (const term of searchTerms) {
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=5&srsearch=${encodeURIComponent(term)}`;
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                continue;
            }
            const data = await response.json() as {
                query?: { search?: Array<{ title?: string }> };
            };
            const results = data.query?.search || [];
            for (const result of results) {
                const title = (result.title || "").trim();
                if (!title) {
                    continue;
                }
                const wikilink = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
                const release = await getAlbumReleaseFromApi(wikilink);
                if (!release || !release.year || release.year !== targetYear) {
                    continue;
                }
                const parsedArtist = normalizeKey(release.artist_name || "");
                const targetArtist = normalizeKey(artist.artistname || "");
                if (parsedArtist && targetArtist && (parsedArtist.includes(targetArtist) || targetArtist.includes(parsedArtist))) {
                    return release.wikilink || wikilink;
                }
            }
        } catch (e) {
        }
    }

    return "";
}
