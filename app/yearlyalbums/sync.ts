import {getHtml} from "app/clients/wikipedia";
import yearlyAlbums from "app/repositories/yearlyalbums/yearlyalbums";
import {YearlyAlbumReference} from "app/yearlyalbums/reference";
import artists from "app/repositories/artists/artists";
import * as cheerio from "cheerio";
import {db} from "app/repositories/db";
import {normalizeWikipediaUrl, shouldProcessEntry} from "app/yearlyalbums/syncmatch";
import {getAlbumReleaseFromApi} from "app/clients/wikipediaapi";
import discography from "app/repositories/discography/discography";
import {handleLink as handleArtistLink} from "app/artists/scrape";
import {createHash} from "crypto";
import {
    buildYearlyAlbumSourcePages,
    DEFAULT_YEARLY_ALBUM_SYNC_START_YEAR,
    getPrimaryYearlyAlbumSourceWikilink,
    MIN_YEARLY_ALBUM_YEAR,
} from "app/yearlyalbums/sourcepages";

const START_YEAR = DEFAULT_YEARLY_ALBUM_SYNC_START_YEAR;
const END_YEAR = Math.max(START_YEAR, new Date().getFullYear());

export async function syncYearlyAlbumReferences(yearArg?: string, modeArg?: string): Promise<void> {
    const parsedYear = parseYearArg(yearArg);
    if (yearArg && parsedYear === undefined) {
        return;
    }
    const freshMode = parseFreshMode(modeArg);
    const specificYear = parsedYear ?? null;
    if (freshMode && !specificYear) {
        console.log(`[yearly.albums.sync] 'fresh' requires a specific year. example: yearly.albums.sync 2026 fresh`);
        return;
    }

    if (freshMode && specificYear) {
        const cleared = await clearReleaseContentHashesForYear(specificYear);
        console.log(`[yearly.albums.sync] fresh=true year=${specificYear} cleared_release_content_hashes=${cleared}`);
    }

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

    if (specificYear) {
        const sourcePageUrls = buildYearlyAlbumSourcePages(specificYear);
        const primarySourceWikilink = getPrimaryYearlyAlbumSourceWikilink(specificYear);
        const categorySource = await getCategorySourcePayload(specificYear);
        const sourcePages = await Promise.all(sourcePageUrls.map(async (pageUrl) => ({
            pageUrl,
            payload: await getSourcePagePayload(pageUrl),
        })));
        if (!categorySource.changed) {
            console.log(
                `[yearly.albums.sync] category source unchanged; running album hash refresh anyway for ${categorySource.sourceWikilink}`,
            );
        }
        await syncFromCategoryPagesForYear(specificYear, categorySource, primarySourceWikilink);
        for (const sourcePage of sourcePages) {
            console.log(`[yearly.albums.sync] reconciling references from list page: ${sourcePage.pageUrl}`);
            await syncFromSourcePage(sourcePage.pageUrl, artistWikilinks, sourcePage.payload, true);
        }
        console.log("[yearly.albums.sync] complete.");
        return;
    }

    for (let i = 0; i < pages.length; i++) {
        const pageUrl = pages[i];
        console.log(`[yearly.albums.sync] page ${i + 1}/${pages.length}: ${pageUrl}`);
        await syncFromSourcePage(pageUrl, artistWikilinks);
    }

    console.log("[yearly.albums.sync] complete.");
}

type CategorySourcePayload = {
    sourceWikilink: string;
    contentHash: string;
    changed: boolean;
    albumLinks: string[];
};

async function syncFromCategoryPagesForYear(
    year: number,
    categorySourcePayload?: CategorySourcePayload,
    sourceListWikilink: string = getPrimaryYearlyAlbumSourceWikilink(year),
): Promise<void> {
    const categorySource = categorySourcePayload || await getCategorySourcePayload(year);
    const albumLinks = categorySource.albumLinks;
    const releaseByAlbumUrl = await loadReleaseByAlbumUrlIndexForYear(year);

    const foundAlbumLinks = new Set<string>();
    let upserted = 0;
    let skippedNoReleaseMatch = 0;
    let releasesInsertedOrUpdated = 0;
    let errors = 0;

    for (const albumWikilink of albumLinks) {
        const normalizedAlbumWikilink = normalizeWikipediaUrl(albumWikilink);
        let release = releaseByAlbumUrl.get(normalizedAlbumWikilink);
        try {
            const refreshed = await ensureReleaseExistsForAlbum(albumWikilink);
            if (refreshed.release) {
                release = refreshed.release;
                releaseByAlbumUrl.set(normalizedAlbumWikilink, refreshed.release);
            }
            if (refreshed.updated) {
                releasesInsertedOrUpdated += 1;
            }
        } catch (e) {
            errors += 1;
            const message = e instanceof Error ? e.message : String(e);
            console.log(
                `[yearly.albums.sync] category backfill error year=${year} album=${albumWikilink} message=${message}`,
            );
        }

        const reference: YearlyAlbumReference = {
            album_name: release?.original_title || release?.title || wikiTitleFromUrl(albumWikilink),
            album_wikilink: albumWikilink,
            wikipedia_page_id: release?.wikipedia_page_id ?? null,
            release_year: release?.dateyear ?? year,
            release_month: release?.datemonth || "",
            release_day: release?.dateday ?? null,
            genre: release?.genre || "",
            record_label: release?.label || "",
            source_list_wikilink: sourceListWikilink,
        };

        if (!release) {
            skippedNoReleaseMatch += 1;
        }

        try {
            await yearlyAlbums.upsert(reference);
            foundAlbumLinks.add(albumWikilink);
            upserted += 1;
        } catch (e) {
            errors += 1;
            const message = e instanceof Error ? e.message : String(e);
            console.log(
                `[yearly.albums.sync] category upsert error year=${year} album=${albumWikilink} message=${message}`,
            );
        }
    }

    const deleted = await yearlyAlbums.deleteMissingForSource(sourceListWikilink, [...foundAlbumLinks]);
    if (errors === 0) {
        await yearlyAlbums.upsertSourceContentHash(categorySource.sourceWikilink, categorySource.contentHash);
    }
    console.log(
        `[yearly.albums.sync] source=${sourceListWikilink} mode=category year=${year} category_albums=${albumLinks.length} upserted=${upserted} releases_backfilled=${releasesInsertedOrUpdated} skipped_no_release_match=${skippedNoReleaseMatch} deleted=${deleted} errors=${errors}`,
    );
}

function parseYearArg(yearArg?: string): number | undefined {
    if (!yearArg) {
        return undefined;
    }

    const parsed = parseInt(yearArg, 10);
    if (Number.isNaN(parsed) || parsed < MIN_YEARLY_ALBUM_YEAR || parsed > END_YEAR) {
        console.log(`[yearly.albums.sync] invalid year "${yearArg}". expected ${MIN_YEARLY_ALBUM_YEAR}-${END_YEAR}`);
        return undefined;
    }

    return parsed;
}

function parseFreshMode(modeArg?: string): boolean {
    if (!modeArg) {
        return false;
    }
    const normalized = modeArg.trim().toLowerCase();
    return normalized === "fresh" || normalized === "--fresh";
}

function buildYearlyAlbumListPages(startYear: number, endYear: number): string[] {
    const pages: string[] = [];
    for (let year = startYear; year <= endYear; year++) {
        pages.push(...buildYearlyAlbumSourcePages(year));
    }
    return pages;
}

type SourcePagePayload = {
    html: string;
    contentHash: string;
    changed: boolean;
};

async function syncFromSourcePage(
    sourcePageUrl: string,
    artistWikilinks: Set<string>,
    sourcePagePayload?: SourcePagePayload,
    forceRun: boolean = false,
): Promise<void> {
    const sourcePage = sourcePagePayload || await getSourcePagePayload(sourcePageUrl);
    if (!sourcePage.changed && !forceRun) {
        console.log(`[yearly.albums.sync] source unchanged; skipping ${sourcePageUrl}`);
        return;
    }
    const html = sourcePage.html;
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
    if (errors === 0) {
        await yearlyAlbums.upsertSourceContentHash(sourcePageUrl, sourcePage.contentHash);
    }

    console.log(
        `[yearly.albums.sync] source=${sourcePageUrl} candidates=${uniqueEntries.length} upserted=${upserted} skipped_missing_artist=${skippedMissingArtist} deleted=${deleted} errors=${errors}`,
    );
    if (skippedMissingArtistSamples.length > 0) {
        console.log(`[yearly.albums.sync] skipped_missing_artist_samples=${skippedMissingArtistSamples.join("; ")}`);
    }
}

async function getSourcePagePayload(sourcePageUrl: string): Promise<SourcePagePayload> {
    const html = await getHtml(sourcePageUrl);
    const contentHash = createHash("sha256").update(html).digest("hex");
    const previousHash = await yearlyAlbums.getSourceContentHash(sourcePageUrl);
    const changed = previousHash !== contentHash;

    return {
        html,
        contentHash,
        changed,
    };
}

async function getCategorySourcePayload(year: number): Promise<CategorySourcePayload> {
    const sourceWikilink = `https://en.wikipedia.org/wiki/Category:${year}_albums`;
    const collected = await collectAlbumLinksFromCategoryPages(year);
    const previousHash = await yearlyAlbums.getSourceContentHash(sourceWikilink);

    return {
        sourceWikilink,
        contentHash: collected.contentHash,
        changed: previousHash !== collected.contentHash,
        albumLinks: collected.albumLinks,
    };
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
    const tables = selectYearlyAlbumTables($, sourcePageUrl);
    const releaseYear = parseYearFromSourceListUrl(sourcePageUrl);

    tables.each((_, tableEl) => {
        const rows = $(tableEl).find("tr");
        const columns = detectYearlyAlbumTableColumns($, rows);
        let activeMonth = "";
        let activeDay: number | null = null;

        rows.each((rowIndex, rowEl) => {
            if (rowIndex === 0) {
                return;
            }
            const row = $(rowEl);
            const cells = row.children("th,td");
            if (cells.length < 3) {
                return;
            }

            const leftShift = Math.max(0, columns.headerWidth - cells.length);
            const resolvedArtistIndex = resolveShiftedColumnIndex(columns.artistIndex, leftShift);
            const resolvedAlbumIndex = resolveShiftedColumnIndex(columns.albumIndex, leftShift);
            const resolvedGenreIndex = resolveShiftedColumnIndex(columns.genreIndex, leftShift);
            const resolvedLabelIndex = resolveShiftedColumnIndex(columns.labelIndex, leftShift);

            const firstCell = cells.eq(0);
            const firstIsDateHeader = firstCell.is("th") && firstCell.attr("scope") === "row";
            const fallbackArtistCell = firstIsDateHeader ? cells.eq(1) : cells.eq(0);
            const fallbackAlbumCell = firstIsDateHeader ? cells.eq(2) : cells.eq(1);
            const fallbackGenreCell = firstIsDateHeader ? cells.eq(3) : cells.eq(2);
            const fallbackLabelCell = firstIsDateHeader ? cells.eq(4) : cells.eq(3);
            const artistCell = hasColumnIndex(cells, resolvedArtistIndex) ? cells.eq(resolvedArtistIndex) : fallbackArtistCell;
            const albumCell = hasColumnIndex(cells, resolvedAlbumIndex) ? cells.eq(resolvedAlbumIndex) : fallbackAlbumCell;
            const genreCell = hasColumnIndex(cells, resolvedGenreIndex) ? cells.eq(resolvedGenreIndex) : fallbackGenreCell;
            const labelCell = hasColumnIndex(cells, resolvedLabelIndex) ? cells.eq(resolvedLabelIndex) : fallbackLabelCell;

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

            const dateColumnStop = Math.min(
                resolvedArtistIndex >= 0 ? resolvedArtistIndex : Number.MAX_SAFE_INTEGER,
                resolvedAlbumIndex >= 0 ? resolvedAlbumIndex : Number.MAX_SAFE_INTEGER,
            );
            const fallbackDateColumnStop = Math.min(firstIsDateHeader ? 1 : 0, cells.length);
            const dateCellsToRead = dateColumnStop === Number.MAX_SAFE_INTEGER
                ? fallbackDateColumnStop
                : Math.max(0, Math.min(dateColumnStop, cells.length));

            for (let i = 0; i < dateCellsToRead; i++) {
                const parsedDate = parseReleaseDateFromCellText(cells.eq(i).text());
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

type YearlyTableColumns = {
    headerWidth: number;
    artistIndex: number;
    albumIndex: number;
    genreIndex: number;
    labelIndex: number;
};

function selectYearlyAlbumTables($: cheerio.CheerioAPI, sourcePageUrl: string): cheerio.Cheerio<any> {
    const year = parseYearFromSourceListUrl(sourcePageUrl);
    if (year !== null && year <= 2004) {
        const legacySectionTables = selectLegacyAlbumsReleasedTables($);
        if (legacySectionTables.length > 0) {
            return legacySectionTables;
        }
    }

    const plainRowHeaderTables = $(".wikitable.plainrowheaders");
    if (plainRowHeaderTables.length > 0) {
        return plainRowHeaderTables;
    }

    return $(".wikitable");
}

function selectLegacyAlbumsReleasedTables($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
    const contentRoot = $("#mw-content-text .mw-parser-output").first();
    const scope = contentRoot.length ? contentRoot : $("body").first();
    const heading = scope.find("h2, h3").filter((_, el) => {
        const node = $(el);
        const headingId = (node.find(".mw-headline").first().attr("id") || "").trim().toLowerCase();
        const headingText = normalizeCellText(node.text()).toLowerCase();
        return headingId === "albums_released" || headingText === "albums released";
    }).first();

    if (!heading.length) {
        return $();
    }

    const tables: any[] = [];
    let cursor = heading.next();
    while (cursor.length) {
        if (cursor.is("h2")) {
            break;
        }
        if (cursor.is("table.wikitable")) {
            const tableNode = cursor.get(0);
            if (tableNode) {
                tables.push(tableNode);
            }
        }
        cursor.find("table.wikitable").each((_, tableEl) => {
            tables.push(tableEl);
        });
        cursor = cursor.next();
    }

    return $(tables);
}

function detectYearlyAlbumTableColumns($: cheerio.CheerioAPI, rows: cheerio.Cheerio<any>): YearlyTableColumns {
    const headerRow = rows.first();
    const headerCells = headerRow.children("th,td");
    const labels = headerCells
        .toArray()
        .map((cell) => normalizeCellText($(cell).text()).toLowerCase());

    return {
        headerWidth: Math.max(1, headerCells.length),
        artistIndex: findColumnIndex(labels, ["artist", "artists", "performer"]),
        albumIndex: findColumnIndex(labels, ["album", "title"]),
        genreIndex: findColumnIndex(labels, ["genre"]),
        labelIndex: findColumnIndex(labels, ["label", "record label"]),
    };
}

function findColumnIndex(labels: string[], candidates: string[]): number {
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        if (candidates.some((candidate) => label.includes(candidate))) {
            return i;
        }
    }
    return -1;
}

function resolveShiftedColumnIndex(index: number, leftShift: number): number {
    if (index < 0) {
        return -1;
    }
    return Math.max(0, index - leftShift);
}

function hasColumnIndex(cells: cheerio.Cheerio<any>, index: number): boolean {
    return index >= 0 && index < cells.length;
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
    const listMatch = sourcePageUrl.match(/List_of_(\d{4})_albums/);
    const legacyMatch = sourcePageUrl.match(/\/(\d{4})_in_music(?:$|[?#])/);
    const yearRaw = listMatch?.[1] || legacyMatch?.[1];
    if (!yearRaw) {
        return null;
    }

    const year = parseInt(yearRaw, 10);
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

async function collectAlbumLinksFromCategoryPages(year: number): Promise<{ albumLinks: string[]; contentHash: string }> {
    const links = new Set<string>();
    const visited = new Set<string>();
    const pageHashes: string[] = [];
    let pageUrl = `https://en.wikipedia.org/wiki/Category:${year}_albums`;
    let pageCount = 0;

    while (pageUrl && !visited.has(pageUrl)) {
        visited.add(pageUrl);
        pageCount += 1;
        console.log(`[yearly.albums.sync] category page ${pageCount}: ${pageUrl}`);

        const html = await getHtml(pageUrl);
        pageHashes.push(createHash("sha256").update(html).digest("hex"));
        const $ = cheerio.load(html);

        $("#mw-pages a[href^='/wiki/']").each((_, el) => {
            const href = $(el).attr("href");
            if (!href) {
                return;
            }
            if (href.includes(":") || href.includes("#") || href.startsWith("/wiki/Category:")) {
                return;
            }
            links.add(`https://en.wikipedia.org${href}`);
        });

        const nextHref = $("#mw-pages a").filter((_, el) => {
            return $(el).text().trim().toLowerCase() === "next page";
        }).first().attr("href");

        pageUrl = nextHref ? `https://en.wikipedia.org${nextHref}` : "";
    }

    const contentHash = createHash("sha256").update(pageHashes.join("|")).digest("hex");
    return { albumLinks: [...links], contentHash };
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

async function clearReleaseContentHashesForYear(year: number): Promise<number> {
    const rows: Array<{ id: number }> = await db`
        update releases
        set content_hash = null
        where dateyear = ${year}
          and content_hash is not null
        returning id
    `;
    return rows.length;
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

async function loadReleaseByAlbumUrlIndexForYear(year: number): Promise<Map<string, {
    title: string;
    original_title: string | null;
    wikipedia_page_id: number | null;
    dateyear: number | null;
    datemonth: string;
    dateday: number | null;
    genre: string | null;
    label: string;
}>> {
    const index = new Map<string, {
        title: string;
        original_title: string | null;
        wikipedia_page_id: number | null;
        dateyear: number | null;
        datemonth: string;
        dateday: number | null;
        genre: string | null;
        label: string;
    }>();

    const rows: Array<{
        wikilink: string;
        title: string;
        original_title: string | null;
        wikipedia_page_id: number | null;
        dateyear: number | null;
        datemonth: string;
        dateday: number | null;
        genre: string | null;
        label: string;
    }> = await db`
        select
            wikilink,
            title,
            original_title,
            wikipedia_page_id,
            dateyear,
            datemonth,
            dateday,
            genre,
            label
        from releases
        where dateyear = ${year}
          and wikilink is not null
          and length(wikilink) > 0
    `;

    for (const row of rows) {
        const key = normalizeWikipediaUrl(row.wikilink);
        if (!index.has(key)) {
            index.set(key, row);
        }
    }

    return index;
}

async function getReleaseByAlbumWikilink(albumWikilink: string): Promise<{
    title: string;
    original_title: string | null;
    wikipedia_page_id: number | null;
    dateyear: number | null;
    datemonth: string;
    dateday: number | null;
    genre: string | null;
    label: string;
    content_hash: string | null;
} | null> {
    const rows: Array<{
        title: string;
        original_title: string | null;
        wikipedia_page_id: number | null;
        dateyear: number | null;
        datemonth: string;
        dateday: number | null;
        genre: string | null;
        label: string;
        content_hash: string | null;
    }> = await db`
        select
            title,
            original_title,
            wikipedia_page_id,
            dateyear,
            datemonth,
            dateday,
            genre,
            label,
            content_hash
        from releases
        where lower(wikilink) = lower(${albumWikilink})
        limit 1
    `;

    return rows[0] || null;
}

async function ensureReleaseExistsForAlbum(albumWikilink: string): Promise<{
    release: {
        title: string;
        original_title: string | null;
        wikipedia_page_id: number | null;
        dateyear: number | null;
        datemonth: string;
        dateday: number | null;
        genre: string | null;
        label: string;
        content_hash: string | null;
    } | null;
    updated: boolean;
}> {
    const existing = await getReleaseByAlbumWikilink(albumWikilink);
    const albumHtml = await getHtml(albumWikilink);
    const contentHash = createHash("sha256").update(albumHtml).digest("hex");
    if (existing?.content_hash === contentHash) {
        return { release: existing, updated: false };
    }

    const apiRelease = await getAlbumReleaseFromApi(albumWikilink);
    if (!apiRelease) {
        return { release: existing, updated: false };
    }

    const artistWikilink = (apiRelease.artist_wikilink || "").trim();
    if (!artistWikilink) {
        return { release: existing, updated: false };
    }

    let artist = await artists.getArtistByUrl(artistWikilink);
    if (!artist) {
        await handleArtistLink(artistWikilink);
        artist = await artists.getArtistByUrl(artistWikilink);
    }
    if (!artist) {
        return { release: existing, updated: false };
    }

    await discography.upsertRelease(apiRelease, artist, contentHash);
    return {
        release: await getReleaseByAlbumWikilink(albumWikilink),
        updated: true,
    };
}

function wikiTitleFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const raw = parsed.pathname.replace(/^\/wiki\//, "");
        return decodeURIComponent(raw).replace(/_/g, " ");
    } catch (e) {
        return url;
    }
}
