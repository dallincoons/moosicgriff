import {getHtml} from "app/clients/wikipedia";
import yearlyAlbums from "app/repositories/yearlyalbums/yearlyalbums";
import {YearlyAlbumReference} from "app/yearlyalbums/reference";
import artists from "app/repositories/artists/artists";
import * as cheerio from "cheerio";
import {db} from "app/repositories/db";
import {normalizeWikipediaUrl, shouldProcessEntry} from "app/yearlyalbums/syncmatch";

const START_YEAR = 2005;
const END_YEAR = Math.max(START_YEAR, new Date().getFullYear());

export async function syncYearlyAlbumReferences(yearArg?: string): Promise<void> {
    const parsedYear = parseYearArg(yearArg);
    if (yearArg && parsedYear === undefined) {
        return;
    }
    const specificYear = parsedYear ?? null;
    const pages = specificYear
        ? buildYearlyAlbumListPages(specificYear, specificYear)
        : buildYearlyAlbumListPages(START_YEAR, END_YEAR);
    const rangeLabel = specificYear ? `${specificYear}` : `${START_YEAR}-${END_YEAR}`;
    console.log(`[yearly.albums.sync] syncing ${pages.length} yearly list pages (${rangeLabel})`);
    const artistRows = await artists.getAll();
    const artistWikilinks = new Set<string>();
    for (const artist of artistRows) {
        const wikilink = (artist.wikilink || "").trim();
        if (wikilink) {
            artistWikilinks.add(normalizeWikipediaUrl(wikilink));
        }

        // Parent links often preserve the originally discovered alias/redirect link.
        const parentWikilink = (artist.parent_wikilink || "").trim();
        if (parentWikilink) {
            artistWikilinks.add(normalizeWikipediaUrl(parentWikilink));
        }
    }
    console.log(
        `[yearly.albums.sync] loaded ${artistRows.length} artists (${artistWikilinks.size} canonical+alias wikilinks)`,
    );

    for (let i = 0; i < pages.length; i++) {
        const pageUrl = pages[i];
        console.log(`[yearly.albums.sync] page ${i + 1}/${pages.length}: ${pageUrl}`);
        await syncFromSourcePage(pageUrl, artistWikilinks);
    }

    console.log("[yearly.albums.sync] complete.");
}

function parseYearArg(yearArg?: string): number | undefined {
    if (!yearArg) {
        return undefined;
    }

    const parsed = parseInt(yearArg, 10);
    if (Number.isNaN(parsed) || parsed < START_YEAR || parsed > END_YEAR) {
        console.log(`[yearly.albums.sync] invalid year "${yearArg}". expected ${START_YEAR}-${END_YEAR}`);
        return undefined;
    }

    return parsed;
}

function buildYearlyAlbumListPages(startYear: number, endYear: number): string[] {
    const pages: string[] = [];
    for (let year = startYear; year <= endYear; year++) {
        pages.push(`https://en.wikipedia.org/wiki/List_of_${year}_albums`);
    }
    return pages;
}

async function syncFromSourcePage(sourcePageUrl: string, artistWikilinks: Set<string>): Promise<void> {
    const html = await getHtml(sourcePageUrl);
    if (isMissingArticleHtml(html)) {
        console.log(`[yearly.albums.sync] skip missing page: ${sourcePageUrl}`);
        return;
    }
    const releasePageIdByAlbumUrl = await loadReleasePageIdIndexForSourceYear(sourcePageUrl);
    const releaseArtistWikilinks = await loadReleaseArtistWikilinkIndexForSourceYear(sourcePageUrl);
    const releaseArtistByAlbumUrl = await loadReleaseArtistByAlbumUrlIndexForSourceYear(sourcePageUrl);
    const entries = extractAlbumEntriesFromYearlyListHtml(sourcePageUrl, html);
    const uniqueEntriesByAlbum = new Map<string, YearlyListEntry>();
    for (const entry of entries) {
        if (!entry.albumWikilink.includes("/wiki/List_of_")) {
            uniqueEntriesByAlbum.set(entry.albumWikilink, entry);
        }
    }
    const uniqueEntries = [...uniqueEntriesByAlbum.values()];
    const foundAlbumLinks = new Set<string>();
    let upserted = 0;
    let skippedMissingArtist = 0;
    let errors = 0;
    const skippedMissingArtistSamples: string[] = [];

    for (let i = 0; i < uniqueEntries.length; i++) {
        const entry = uniqueEntries[i];
        const artistExists = shouldProcessEntry(
            entry.artistWikilink,
            entry.albumWikilink,
            artistWikilinks,
            releaseArtistWikilinks,
            releaseArtistByAlbumUrl,
        );
        if (!artistExists) {
            skippedMissingArtist += 1;
            if (skippedMissingArtistSamples.length < 10) {
                skippedMissingArtistSamples.push(`${entry.artistWikilink} -> ${entry.albumWikilink}`);
            }
            continue;
        }

        try {
            const albumWikilink = entry.albumWikilink;
            foundAlbumLinks.add(albumWikilink);

            const reference: YearlyAlbumReference = {
                album_name: entry.albumName,
                album_wikilink: albumWikilink,
                wikipedia_page_id: releasePageIdByAlbumUrl.get(normalizeWikipediaUrl(albumWikilink)) ?? null,
                release_year: entry.releaseYear,
                release_month: entry.releaseMonth,
                release_day: entry.releaseDay,
                genre: entry.genre,
                record_label: entry.recordLabel,
                source_list_wikilink: sourcePageUrl,
            };

            await yearlyAlbums.upsert(reference);
            upserted += 1;
        } catch (e) {
            errors += 1;
            const message = e instanceof Error ? e.message : String(e);
            console.log(
                `[yearly.albums.sync] upsert error artist=${entry.artistWikilink} album=${entry.albumWikilink} message=${message}`,
            );
        }
    }

    const deleted = await yearlyAlbums.deleteMissingForSource(sourcePageUrl, [...foundAlbumLinks]);

    console.log(
        `[yearly.albums.sync] source=${sourcePageUrl} candidates=${uniqueEntries.length} upserted=${upserted} skipped_missing_artist=${skippedMissingArtist} deleted=${deleted} errors=${errors}`,
    );
    if (skippedMissingArtistSamples.length > 0) {
        console.log(`[yearly.albums.sync] skipped_missing_artist_samples=${skippedMissingArtistSamples.join("; ")}`);
    }
}

type YearlyListEntry = {
    artistWikilink: string;
    albumWikilink: string;
    albumName: string;
    genre: string;
    recordLabel: string;
    releaseYear: number | null;
    releaseMonth: string;
    releaseDay: number | null;
};

function extractAlbumEntriesFromYearlyListHtml(sourcePageUrl: string, html: string): YearlyListEntry[] {
    const $ = cheerio.load(html);
    const entries: YearlyListEntry[] = [];
    const tables = $(".wikitable.plainrowheaders");
    const releaseYear = parseYearFromSourceListUrl(sourcePageUrl);

    tables.each((_, tableEl) => {
        const rows = $(tableEl).find("tr");
        let activeMonth = "";
        let activeDay: number | null = null;

        rows.each((__, rowEl) => {
            const row = $(rowEl);
            const cells = row.children("th,td");
            if (cells.length < 3) {
                return;
            }

            const firstCell = cells.eq(0);
            const firstIsDateHeader = firstCell.is("th") && firstCell.attr("scope") === "row";
            const artistCell = firstIsDateHeader ? cells.eq(1) : cells.eq(0);
            const albumCell = firstIsDateHeader ? cells.eq(2) : cells.eq(1);
            const genreCell = firstIsDateHeader ? cells.eq(3) : cells.eq(2);
            const labelCell = firstIsDateHeader ? cells.eq(4) : cells.eq(3);

            const albumHref = albumCell.find('a[href^="/wiki/"]').first().attr("href");
            const artistHref = artistCell.find('a[href^="/wiki/"]').first().attr("href");
            if (!albumHref) {
                return;
            }
            if (albumHref.includes(":") || albumHref.includes("#")) {
                return;
            }
            if (artistHref && (artistHref.includes(":") || artistHref.includes("#"))) {
                return;
            }

            if (firstIsDateHeader) {
                const parsedDate = parseReleaseDateFromCellText(firstCell.text());
                if (parsedDate.month) {
                    activeMonth = parsedDate.month;
                }
                if (parsedDate.day !== null) {
                    activeDay = parsedDate.day;
                }
            }

            entries.push({
                artistWikilink: artistHref ? `https://en.wikipedia.org${artistHref}` : "",
                albumWikilink: `https://en.wikipedia.org${albumHref}`,
                albumName: normalizeCellText(albumCell.text()),
                genre: normalizeCellText(genreCell.text()),
                recordLabel: normalizeCellText(labelCell.text()),
                releaseYear,
                releaseMonth: activeMonth,
                releaseDay: activeDay,
            });
        });
    });

    return entries;
}

function normalizeCellText(value: string): string {
    return (value || "")
        .replace(/\[[0-9]+\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function parseReleaseDateFromCellText(value: string): { month: string; day: number | null } {
    const normalized = normalizeCellText(value);
    const monthMatch = normalized.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
    const dayMatch = normalized.match(/\b([1-2]?\d|3[0-1])\b/);

    return {
        month: monthMatch ? capitalize(monthMatch[1]) : "",
        day: dayMatch ? parseInt(dayMatch[1], 10) : null,
    };
}

function parseYearFromSourceListUrl(sourcePageUrl: string): number | null {
    const match = sourcePageUrl.match(/List_of_(\d{4})_albums/);
    if (!match || !match[1]) {
        return null;
    }

    const year = parseInt(match[1], 10);
    return Number.isNaN(year) ? null : year;
}

function capitalize(value: string): string {
    if (!value) {
        return "";
    }
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}


function isMissingArticleHtml(html: string): boolean {
    return /id="noarticletext"/i.test(html) || /Wikipedia does not have an article with this exact name/i.test(html);
}

async function loadReleasePageIdIndexForSourceYear(sourcePageUrl: string): Promise<Map<string, number>> {
    const year = parseYearFromSourceListUrl(sourcePageUrl);
    const index = new Map<string, number>();
    if (!year) {
        return index;
    }

    const rows: Array<{ wikilink: string; wikipedia_page_id: number }> = await db`
        select wikilink, wikipedia_page_id
        from releases
        where dateyear = ${year}
          and wikipedia_page_id is not null
          and wikilink is not null
    `;

    for (const row of rows) {
        const key = normalizeWikipediaUrl(row.wikilink);
        if (!index.has(key)) {
            index.set(key, row.wikipedia_page_id);
        }
    }

    return index;
}

async function loadReleaseArtistWikilinkIndexForSourceYear(sourcePageUrl: string): Promise<Set<string>> {
    const year = parseYearFromSourceListUrl(sourcePageUrl);
    const index = new Set<string>();
    if (!year) {
        return index;
    }

    const rows: Array<{ artist_wikilink: string }> = await db`
        select artist_wikilink
        from releases
        where dateyear = ${year}
          and artist_wikilink is not null
          and length(artist_wikilink) > 0
    `;

    for (const row of rows) {
        index.add(normalizeWikipediaUrl(row.artist_wikilink));
    }

    return index;
}

async function loadReleaseArtistByAlbumUrlIndexForSourceYear(sourcePageUrl: string): Promise<Map<string, string>> {
    const year = parseYearFromSourceListUrl(sourcePageUrl);
    const index = new Map<string, string>();
    if (!year) {
        return index;
    }

    const rows: Array<{ wikilink: string; artist_wikilink: string }> = await db`
        select wikilink, artist_wikilink
        from releases
        where dateyear = ${year}
          and wikilink is not null
          and length(wikilink) > 0
          and artist_wikilink is not null
          and length(artist_wikilink) > 0
    `;

    for (const row of rows) {
        const albumKey = normalizeWikipediaUrl(row.wikilink);
        const artistValue = normalizeWikipediaUrl(row.artist_wikilink);
        if (!index.has(albumKey)) {
            index.set(albumKey, artistValue);
        }
    }

    return index;
}
