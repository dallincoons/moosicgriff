import {getHtml} from "app/clients/wikipedia";
import {db} from "app/repositories/db";
import {buildYearlyAlbumSourcePages} from "app/yearlyalbums/sourcepages";
import {normalizeWikipediaUrl} from "app/yearlyalbums/syncmatch";
import * as cheerio from "cheerio";

type CitedAlbumRow = {
    sourcePage: string;
    albumWikilink: string;
    albumName: string;
    artistName: string;
    releaseYear: number | null;
    releaseMonth: string;
    releaseDay: number | null;
};

type ReleaseReviewRow = {
    title: string;
    original_title: string | null;
    artist_name: string;
    wikilink: string;
    number_of_reviews: number;
    dateyear: number | null;
    datemonth: string;
    dateday: number | null;
};

type YearlyTableColumns = {
    headerRowIndex: number;
    headerWidth: number;
    artistIndex: number;
    albumIndex: number;
    refIndex: number;
};

const MONTH_ORDER = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
] as const;

export async function yearlyAlbumsCitedReviews(yearArg?: string, minReviewsArg?: string): Promise<void> {
    const year = parseInt(yearArg || "", 10);
    if (Number.isNaN(year) || year < 1900 || year > 2100) {
        console.log(`[yearly.albums.cited.reviews] invalid year "${yearArg}". example: yearly.albums.cited.reviews 2026`);
        return;
    }

    const minReviews = parseMinReviews(minReviewsArg);
    if (minReviews === null) {
        console.log(`[yearly.albums.cited.reviews] invalid min_reviews "${minReviewsArg}". example: yearly.albums.cited.reviews 2026 3`);
        return;
    }

    const sourcePages = buildYearlyAlbumSourcePages(year);
    const debug = isDebugEnabled();
    console.log(
        `[yearly.albums.cited.reviews] scanning ${sourcePages.length} source page(s) year=${year} min_reviews=${minReviews}`,
    );
    if (debug) {
        console.log("[yearly.albums.cited.reviews][debug] enabled");
    }

    const citedRows: CitedAlbumRow[] = [];
    const seenAlbumLinks = new Set<string>();
    for (const sourcePage of sourcePages) {
        console.log(`[yearly.albums.cited.reviews] source=${sourcePage}`);
        const html = await getHtml(sourcePage);
        const rows = extractCitedAlbumRows(sourcePage, html, debug);
        for (const row of rows) {
            const key = normalizeWikipediaUrl(row.albumWikilink);
            if (seenAlbumLinks.has(key)) {
                continue;
            }
            seenAlbumLinks.add(key);
            citedRows.push(row);
        }
    }
    console.log(`[yearly.albums.cited.reviews] cited_rows=${citedRows.length}`);

    if (citedRows.length === 0) {
        return;
    }

    const releases = await loadReleasesForYear(year, minReviews);
    if (debug) {
        console.log(`[yearly.albums.cited.reviews][debug] releases_with_min_reviews=${releases.length}`);
    }
    const releaseByAlbumWikilink = new Map<string, ReleaseReviewRow>();
    for (const release of releases) {
        releaseByAlbumWikilink.set(normalizeWikipediaUrl(release.wikilink), release);
    }

    if (debug) {
        const unmatched = citedRows.filter(
            (row) => !releaseByAlbumWikilink.has(normalizeWikipediaUrl(row.albumWikilink)),
        );
        console.log(`[yearly.albums.cited.reviews][debug] cited_rows_without_release_match=${unmatched.length}`);
        for (const row of unmatched.slice(0, 10)) {
            console.log(
                `[yearly.albums.cited.reviews][debug] unmatched source=${row.sourcePage} album="${row.albumName}" artist="${row.artistName}" wikilink=${row.albumWikilink}`,
            );
        }
    }

    const matched = citedRows
        .map((row) => {
            const release = releaseByAlbumWikilink.get(normalizeWikipediaUrl(row.albumWikilink));
            if (!release) {
                return null;
            }
            return {row, release};
        })
        .filter((value): value is { row: CitedAlbumRow; release: ReleaseReviewRow } => value !== null)
        .sort((a, b) => {
            const monthDiff = monthSortIndex(getMatchedMonth(a)) - monthSortIndex(getMatchedMonth(b));
            if (monthDiff !== 0) {
                return monthDiff;
            }
            if (b.release.number_of_reviews !== a.release.number_of_reviews) {
                return b.release.number_of_reviews - a.release.number_of_reviews;
            }
            return a.release.artist_name.localeCompare(b.release.artist_name);
        });

    console.log(`[yearly.albums.cited.reviews] intersection=${matched.length}`);
    const groupedByMonth = new Map<string, Array<{ row: CitedAlbumRow; release: ReleaseReviewRow }>>();
    for (const item of matched) {
        const month = getMatchedMonth(item);
        const existing = groupedByMonth.get(month) || [];
        existing.push(item);
        groupedByMonth.set(month, existing);
    }

    for (const month of [...MONTH_ORDER, "Unknown"]) {
        const items = groupedByMonth.get(month);
        if (!items || items.length === 0) {
            continue;
        }

        console.log("");
        console.log(`=== ${month} ===`);
        for (const item of items) {
            console.log(`Source Page: ${item.row.sourcePage}`);
            console.log(`Album: ${item.release.original_title || item.release.title}`);
            console.log(`Artist: ${item.release.artist_name}`);
            console.log(`Date: ${formatDate(item.release.dateyear, item.release.datemonth, item.release.dateday)}`);
            console.log(`Reviews: ${item.release.number_of_reviews}`);
            console.log(`Album Wikilink: ${item.row.albumWikilink}`);
            console.log("");
        }
    }
    console.log(`Total albums: ${matched.length}`);
}

function parseMinReviews(minReviewsArg?: string): number | null {
    if (!minReviewsArg) {
        return 3;
    }
    const parsed = parseInt(minReviewsArg, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
        return null;
    }
    return parsed;
}

function extractCitedAlbumRows(sourcePage: string, html: string, debug: boolean): CitedAlbumRow[] {
    const $ = cheerio.load(html);
    const out: CitedAlbumRow[] = [];
    const tables = $(".wikitable.plainrowheaders, .wikitable");
    const releaseYear = parseYearFromSourcePage(sourcePage);
    if (debug) {
        console.log(`[yearly.albums.cited.reviews][debug] source=${sourcePage} tables=${tables.length}`);
    }

    tables.each((_, tableEl) => {
        const rows = $(tableEl).find("tr");
        if (rows.length < 2) {
            return;
        }

        const columns = detectYearlyAlbumTableColumns($, rows);
        if (columns.headerRowIndex < 0) {
            if (debug) {
                const firstHeaders = rows.first().children("th,td").toArray().map((cell) => normalizeCellText($(cell).text()));
                console.log(
                    `[yearly.albums.cited.reviews][debug] source=${sourcePage} skip_table reason=no_valid_header first_headers=${JSON.stringify(firstHeaders)}`,
                );
            }
            return;
        }
        if (debug) {
            const headerLabels = rows.eq(columns.headerRowIndex).children("th,td").toArray().map((cell) => normalizeCellText($(cell).text()));
            console.log(
                `[yearly.albums.cited.reviews][debug] source=${sourcePage} headers=${JSON.stringify(headerLabels)} indices={artist:${columns.artistIndex},album:${columns.albumIndex},ref:${columns.refIndex}}`,
            );
        }
        if (columns.albumIndex < 0) {
            return;
        }

        let tableRowCount = 0;
        let tableAlbumLinkCount = 0;
        let tableCitationCount = 0;
        let tableEmittedCount = 0;
        let activeMonth = "";
        let activeDay: number | null = null;

        rows.each((rowIndex, rowEl) => {
            if (rowIndex <= columns.headerRowIndex) {
                return;
            }
            tableRowCount += 1;

            const row = $(rowEl);
            const cells = row.children("th,td");
            if (cells.length < 3) {
                return;
            }

            const leftShift = Math.max(0, columns.headerWidth - cells.length);
            const resolvedArtistIndex = resolveShiftedColumnIndex(columns.artistIndex, leftShift);
            const resolvedAlbumIndex = resolveShiftedColumnIndex(columns.albumIndex, leftShift);
            const resolvedRefIndex = resolveShiftedColumnIndex(columns.refIndex, leftShift);

            const firstCell = cells.eq(0);
            const firstIsDateHeader = firstCell.is("th") && firstCell.attr("scope") === "row";
            const fallbackArtistCell = firstIsDateHeader ? cells.eq(1) : cells.eq(0);
            const fallbackAlbumCell = firstIsDateHeader ? cells.eq(2) : cells.eq(1);
            const fallbackRefCell = firstIsDateHeader ? cells.eq(5) : cells.eq(4);
            const artistCell = hasColumnIndex(cells, resolvedArtistIndex) ? cells.eq(resolvedArtistIndex) : fallbackArtistCell;
            const albumCell = hasColumnIndex(cells, resolvedAlbumIndex) ? cells.eq(resolvedAlbumIndex) : fallbackAlbumCell;
            const refCell = hasColumnIndex(cells, resolvedRefIndex)
                ? cells.eq(resolvedRefIndex)
                : fallbackRefCell;
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

            const albumHref = albumCell.find('a[href^="/wiki/"]').first().attr("href");
            if (!albumHref || albumHref.includes(":") || albumHref.includes("#")) {
                return;
            }
            tableAlbumLinkCount += 1;

            if (!hasCitationInRefCell(refCell)) {
                return;
            }
            tableCitationCount += 1;

            out.push({
                sourcePage,
                albumWikilink: `https://en.wikipedia.org${albumHref}`,
                albumName: normalizeCellText(albumCell.text()),
                artistName: normalizeCellText(artistCell.text()),
                releaseYear,
                releaseMonth: activeMonth,
                releaseDay: activeDay,
            });
            tableEmittedCount += 1;
        });

        if (debug) {
            console.log(
                `[yearly.albums.cited.reviews][debug] source=${sourcePage} table_stats={rows:${tableRowCount},album_links:${tableAlbumLinkCount},citations:${tableCitationCount},emitted:${tableEmittedCount}}`,
            );
        }
    });

    return out;
}

function hasCitationInRefCell(refCell: cheerio.Cheerio<any>): boolean {
    if (!refCell || refCell.length === 0) {
        return false;
    }

    if (refCell.find("sup.reference, a[href*='#cite_note']").length > 0) {
        return true;
    }

    return /\[\d+\]/.test(normalizeCellText(refCell.text()));
}

function detectYearlyAlbumTableColumns($: cheerio.CheerioAPI, rows: cheerio.Cheerio<any>): YearlyTableColumns {
    const detectedHeader = findHeaderRow($, rows);
    if (!detectedHeader) {
        return {
            headerRowIndex: -1,
            headerWidth: 0,
            artistIndex: -1,
            albumIndex: -1,
            refIndex: -1,
        };
    }

    const {headerRowIndex, labels} = detectedHeader;
    const detectedRefIndex = findColumnIndex(labels, ["ref", "refs", "reference"]);
    const fallbackRefIndex = labels.length >= 5 ? labels.length - 1 : -1;

    return {
        headerRowIndex,
        headerWidth: Math.max(1, labels.length),
        artistIndex: findColumnIndex(labels, ["artist", "artists", "performer"]),
        albumIndex: findColumnIndex(labels, ["album", "title"]),
        refIndex: detectedRefIndex >= 0 ? detectedRefIndex : fallbackRefIndex,
    };
}

function findHeaderRow(
    $: cheerio.CheerioAPI,
    rows: cheerio.Cheerio<any>,
): { headerRowIndex: number; labels: string[] } | null {
    const maxRowsToInspect = Math.min(8, rows.length);
    for (let rowIndex = 0; rowIndex < maxRowsToInspect; rowIndex++) {
        const cells = rows.eq(rowIndex).children("th,td");
        if (cells.length < 3) {
            continue;
        }

        const labels = cells.toArray().map((cell) => normalizeCellText($(cell).text()).toLowerCase());
        const hasArtist = findColumnIndex(labels, ["artist", "artists", "performer"]) >= 0;
        const hasAlbum = findColumnIndex(labels, ["album", "title"]) >= 0;
        if (hasArtist && hasAlbum) {
            return {headerRowIndex: rowIndex, labels};
        }
    }

    return null;
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

async function loadReleasesForYear(year: number, minReviews: number): Promise<ReleaseReviewRow[]> {
    const rows: ReleaseReviewRow[] = await db`
        select title, original_title, artist_name, wikilink, number_of_reviews, dateyear, datemonth, dateday
        from releases
        where dateyear = ${year}
          and number_of_reviews >= ${minReviews}
          and wikilink is not null
          and length(wikilink) > 0
    `;
    return rows;
}

function normalizeCellText(value: string): string {
    return (value || "")
        .replace(/\[[0-9]+\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function isDebugEnabled(): boolean {
    const raw = (process.env.DEBUG_YEARLY_ALBUMS_CITED_REVIEWS || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
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

function parseYearFromSourcePage(sourcePageUrl: string): number | null {
    const listMatch = sourcePageUrl.match(/List_of_(\d{4})_albums/);
    const legacyMatch = sourcePageUrl.match(/\/(\d{4})_in_music(?:$|[?#])/);
    const yearRaw = listMatch?.[1] || legacyMatch?.[1];
    if (!yearRaw) {
        return null;
    }
    const year = parseInt(yearRaw, 10);
    return Number.isNaN(year) ? null : year;
}

function formatDate(year: number | null, month: string, day: number | null): string {
    if (!year && !month && day === null) {
        return "(unknown)";
    }
    if (month && day !== null && year) {
        return `${month} ${day}, ${year}`;
    }
    if (month && year) {
        return `${month} ${year}`;
    }
    if (year) {
        return String(year);
    }
    return "(unknown)";
}

function getMatchedMonth(item: { row: CitedAlbumRow; release: ReleaseReviewRow }): string {
    const releaseMonth = normalizeMonthName(item.release.datemonth);
    if (releaseMonth) {
        return releaseMonth;
    }
    const rowMonth = normalizeMonthName(item.row.releaseMonth);
    return rowMonth || "Unknown";
}

function normalizeMonthName(value: string): string {
    const normalized = capitalize((value || "").trim());
    if ((MONTH_ORDER as readonly string[]).includes(normalized)) {
        return normalized;
    }
    return "";
}

function monthSortIndex(month: string): number {
    const index = (MONTH_ORDER as readonly string[]).indexOf(month);
    return index >= 0 ? index : MONTH_ORDER.length;
}

function capitalize(value: string): string {
    if (!value) {
        return "";
    }
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
