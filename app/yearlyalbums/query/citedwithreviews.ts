import {getHtml} from "app/clients/wikipedia";
import {db} from "app/repositories/db";
import {buildYearlyAlbumSourcePages} from "app/yearlyalbums/sourcepages";
import {normalizeWikipediaUrl} from "app/yearlyalbums/syncmatch";
import * as cheerio from "cheerio";

export type CitedAlbumRow = {
    sourcePage: string;
    albumWikilink: string;
    albumName: string;
    artistName: string;
    releaseYear: number | null;
    releaseMonth: string;
    releaseDay: number | null;
    wikipediaPageId: number | null;
};

type ReleaseReviewRow = {
    title: string;
    original_title: string | null;
    artist_name: string;
    wikilink: string;
    wikipedia_page_id: number | string | null;
    effective_number_of_reviews: number;
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

const WIKIPEDIA_NAMESPACES = new Set([
    "category",
    "file",
    "image",
    "wikipedia",
    "project",
    "help",
    "portal",
    "special",
    "template",
    "template talk",
    "talk",
    "user",
    "user talk",
    "draft",
    "draft talk",
    "module",
    "module talk",
    "book",
    "book talk",
    "timedtext",
    "timedtext talk",
    "media",
    "mediawiki",
    "mediawiki talk",
    "education program",
    "education program talk",
    "topic",
    "wikt",
    "wiktionary",
]);

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
            const key = citedRowIdentityKey(row);
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

    await hydrateCitedRowPageIds(citedRows);
    const citedPageIds = citedRows
        .map((row) => row.wikipediaPageId)
        .filter((pageId): pageId is number => pageId !== null);
    const citedArticleTitles = citedRows
        .flatMap((row) => [wikipediaTitleFromUrl(row.albumWikilink), row.albumName])
        .filter((title) => !!title);
    const releases = await loadReleasesForYear(year, minReviews, citedPageIds, citedArticleTitles);
    if (debug) {
        console.log(`[yearly.albums.cited.reviews][debug] releases_with_min_reviews=${releases.length}`);
    }
    const releaseByAlbumWikilink = new Map<string, ReleaseReviewRow>();
    const releaseByPageId = new Map<number, ReleaseReviewRow>();
    const releaseByTitleAndArtist = new Map<string, ReleaseReviewRow>();
    for (const release of releases) {
        releaseByAlbumWikilink.set(normalizeWikipediaUrl(release.wikilink), release);
        const releasePageId = normalizePageId(release.wikipedia_page_id);
        if (releasePageId !== null && !releaseByPageId.has(releasePageId)) {
            releaseByPageId.set(releasePageId, release);
        }
        for (const title of [release.title, release.original_title || ""]) {
            const key = titleArtistKey(title, release.artist_name);
            if (key && !releaseByTitleAndArtist.has(key)) {
                releaseByTitleAndArtist.set(key, release);
            }
        }
    }

    if (debug) {
        const unmatched = citedRows.filter(
            (row) => !findMatchingRelease(row, releaseByAlbumWikilink, releaseByPageId, releaseByTitleAndArtist),
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
            const release = findMatchingRelease(row, releaseByAlbumWikilink, releaseByPageId, releaseByTitleAndArtist);
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
            if (b.release.effective_number_of_reviews !== a.release.effective_number_of_reviews) {
                return b.release.effective_number_of_reviews - a.release.effective_number_of_reviews;
            }
            return a.release.artist_name.localeCompare(b.release.artist_name);
        });

    if (debug) {
        for (const item of matched.slice(0, 10)) {
            console.log(
                `[yearly.albums.cited.reviews][debug] matched album="${item.row.albumName}" row_date=${formatDate(item.row.releaseYear, item.row.releaseMonth, item.row.releaseDay)} release_date=${formatDate(item.release.dateyear, item.release.datemonth, item.release.dateday)} prefer_row_date=${shouldPreferCitedRowDate(item)}`,
            );
        }
    }

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
            console.log(`Album: ${getMatchedAlbumName(item)}`);
            console.log(`Artist: ${item.release.artist_name}`);
            console.log(`Date: ${formatMatchedDate(item)}`);
            console.log(`Reviews: ${item.release.effective_number_of_reviews}`);
            console.log(`Album Wikilink: ${getMatchedAlbumWikilink(item)}`);
            console.log("");
        }
    }
    console.log(`Total albums: ${matched.length}`);
}

function citedRowIdentityKey(row: CitedAlbumRow): string {
    const linkedKey = normalizeWikipediaUrl(row.albumWikilink);
    if (linkedKey) {
        return `linked:${linkedKey}`;
    }
    return `unlinked:${titleArtistKey(row.albumName, row.artistName)}:${row.sourcePage}`;
}

function normalizePageId(value: number | string | null): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        const parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function findMatchingRelease(
    row: CitedAlbumRow,
    releaseByAlbumWikilink: Map<string, ReleaseReviewRow>,
    releaseByPageId: Map<number, ReleaseReviewRow>,
    releaseByTitleAndArtist: Map<string, ReleaseReviewRow>,
): ReleaseReviewRow | undefined {
    const byUrl = releaseByAlbumWikilink.get(normalizeWikipediaUrl(row.albumWikilink));
    if (byUrl) {
        return byUrl;
    }
    if (hasWikipediaFragment(row.albumWikilink)) {
        return undefined;
    }
    if (row.wikipediaPageId !== null) {
        const byPageId = releaseByPageId.get(row.wikipediaPageId);
        if (byPageId) {
            return byPageId;
        }
    }
    const titleFromWikilink = wikipediaTitleFromUrl(row.albumWikilink);
    return releaseByTitleAndArtist.get(titleArtistKey(titleFromWikilink, row.artistName))
        ?? releaseByTitleAndArtist.get(titleArtistKey(row.albumName, row.artistName));
}

function hasWikipediaFragment(url: string): boolean {
    try {
        return !!new URL(url).hash;
    } catch {
        return url.includes("#");
    }
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
            if (firstIsDateHeader) {
                const parsedDate = parseReleaseDateFromCellText(firstCell.text());
                if (parsedDate.month) {
                    activeMonth = parsedDate.month;
                }
                if (parsedDate.day !== null) {
                    activeDay = parsedDate.day;
                }
            }
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

            const albumName = normalizeCellText(albumCell.text());
            if (!albumName) {
                return;
            }

            const albumHref = albumCell.find('a[href^="/wiki/"]').first().attr("href") || "";
            if (albumHref && isSkippableCitedAlbumHref(albumHref)) {
                return;
            }
            if (albumHref) {
                tableAlbumLinkCount += 1;
            }

            if (!hasCitationInRefCell(refCell)) {
                return;
            }
            tableCitationCount += 1;

            out.push({
                sourcePage,
                albumWikilink: albumHref ? `https://en.wikipedia.org${albumHref}` : "",
                albumName,
                artistName: normalizeCellText(artistCell.text()),
                releaseYear,
                releaseMonth: activeMonth,
                releaseDay: activeDay,
                wikipediaPageId: null,
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

export function extractCitedAlbumRowsForTesting(sourcePage: string, html: string): CitedAlbumRow[] {
    return extractCitedAlbumRows(sourcePage, html, false);
}

function isSkippableCitedAlbumHref(href: string): boolean {
    const normalizedHref = (href || "").trim();
    if (!normalizedHref || !normalizedHref.startsWith("/wiki/")) {
        return true;
    }

    const titleWithoutFragment = normalizedHref.slice("/wiki/".length).replace(/#.*$/, "");
    if (!titleWithoutFragment) {
        return true;
    }

    let decodedTitle = titleWithoutFragment;
    try {
        decodedTitle = decodeURIComponent(titleWithoutFragment);
    } catch {
        decodedTitle = titleWithoutFragment;
    }

    const namespaceSeparator = decodedTitle.indexOf(":");
    if (namespaceSeparator < 0) {
        return false;
    }

    const namespace = decodedTitle.slice(0, namespaceSeparator).replace(/_/g, " ").trim().toLowerCase();
    return WIKIPEDIA_NAMESPACES.has(namespace);
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

async function loadReleasesForYear(
    year: number,
    minReviews: number,
    citedPageIds: number[],
    citedArticleTitles: string[],
): Promise<ReleaseReviewRow[]> {
    const uniqueCitedPageIds = [...new Set(citedPageIds)];
    const uniqueCitedArticleTitles = [...new Set(citedArticleTitles.map(normalizeTitleKey).filter((title) => !!title))];
    const rows: ReleaseReviewRow[] = await db`
        select
            title,
            original_title,
            artist_name,
            wikilink,
            wikipedia_page_id,
            coalesce(manual_number_of_reviews, number_of_reviews) as effective_number_of_reviews,
            dateyear,
            datemonth,
            dateday
        from releases
        where (
            dateyear = ${year}
            or (
                ${uniqueCitedPageIds.length} > 0
                and wikipedia_page_id = any(${uniqueCitedPageIds}::bigint[])
            )
            or (
                ${uniqueCitedArticleTitles.length} > 0
                and lower(coalesce(original_title, title)) = any(${uniqueCitedArticleTitles}::text[])
            )
            or (
                ${uniqueCitedArticleTitles.length} > 0
                and lower(title) = any(${uniqueCitedArticleTitles}::text[])
            )
        )
          and coalesce(manual_number_of_reviews, number_of_reviews) >= ${minReviews}
          and wikilink is not null
          and length(wikilink) > 0
    `;
    return rows;
}

function titleArtistKey(title: string, artistName: string): string {
    const normalizedTitle = normalizeTitleKey(title);
    const normalizedArtist = normalizeTitleKey(artistName);
    if (!normalizedTitle || !normalizedArtist) {
        return "";
    }
    return `${normalizedTitle}|${normalizedArtist}`;
}

function normalizeTitleKey(value: string): string {
    return (value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

async function hydrateCitedRowPageIds(rows: CitedAlbumRow[]): Promise<void> {
    const titleToRows = new Map<string, CitedAlbumRow[]>();
    for (const row of rows) {
        const title = wikipediaTitleFromUrl(row.albumWikilink);
        if (!title) {
            continue;
        }
        const existing = titleToRows.get(title) || [];
        existing.push(row);
        titleToRows.set(title, existing);
    }

    const titles = [...titleToRows.keys()];
    const batchSize = 50;
    for (let i = 0; i < titles.length; i += batchSize) {
        const batch = titles.slice(i, i + batchSize);
        const encodedTitles = batch.map((title) => encodeURIComponent(title)).join("|");
        const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&titles=${encodedTitles}`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
            continue;
        }
        const data = await response.json() as {
            query?: {
                normalized?: Array<{ from?: string; to?: string }>;
                redirects?: Array<{ from?: string; to?: string }>;
                pages?: Array<{ pageid?: number; title?: string; missing?: boolean }>;
            };
        };

        const titleAliases = new Map<string, string>();
        for (const normalized of data.query?.normalized || []) {
            if (normalized.from && normalized.to) {
                titleAliases.set(normalized.from, normalized.to);
            }
        }
        for (const redirect of data.query?.redirects || []) {
            if (redirect.from && redirect.to) {
                titleAliases.set(resolveTitleAlias(redirect.from, titleAliases), redirect.to);
                titleAliases.set(redirect.from, redirect.to);
            }
        }

        for (const page of data.query?.pages || []) {
            if (!page.title || !page.pageid || page.missing) {
                continue;
            }
            for (const inputTitle of batch) {
                const resolvedTitle = resolveTitleAlias(inputTitle, titleAliases);
                if (resolvedTitle !== page.title) {
                    continue;
                }
                for (const row of titleToRows.get(inputTitle) || []) {
                    row.wikipediaPageId = page.pageid;
                }
            }
        }
    }
}

function resolveTitleAlias(title: string, aliases: Map<string, string>): string {
    let current = title;
    const seen = new Set<string>();
    while (aliases.has(current) && !seen.has(current)) {
        seen.add(current);
        current = aliases.get(current) || current;
    }
    return current;
}

function wikipediaTitleFromUrl(url: string): string {
    const input = (url || "").trim();
    if (!input) {
        return "";
    }

    try {
        const parsed = new URL(input);
        if (parsed.hostname !== "en.wikipedia.org" || !parsed.pathname.startsWith("/wiki/")) {
            return "";
        }
        return decodeURIComponent(parsed.pathname.slice("/wiki/".length)).replace(/_/g, " ");
    } catch {
        return "";
    }
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
    const monthMatch = normalized.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)(?=\b|\d)/i);
    const dayMatch = monthMatch
        ? normalized.slice(monthMatch.index! + monthMatch[0].length).match(/^\s*([1-2]?\d|3[0-1])(?=\D|$)/)
        : normalized.match(/\b([1-2]?\d|3[0-1])\b/);

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
    if (shouldPreferCitedRowDate(item)) {
        const rowMonth = normalizeMonthName(item.row.releaseMonth);
        return rowMonth || "Unknown";
    }
    const releaseMonth = normalizeMonthName(item.release.datemonth);
    if (releaseMonth) {
        return releaseMonth;
    }
    const rowMonth = normalizeMonthName(item.row.releaseMonth);
    return rowMonth || "Unknown";
}

function getMatchedAlbumName(item: { row: CitedAlbumRow; release: ReleaseReviewRow }): string {
    if (shouldPreferCitedRowDate(item) && item.row.albumName) {
        return item.row.albumName;
    }
    return item.release.original_title || item.release.title;
}

function getMatchedAlbumWikilink(item: { row: CitedAlbumRow; release: ReleaseReviewRow }): string {
    return item.row.albumWikilink || item.release.wikilink;
}

function formatMatchedDate(item: { row: CitedAlbumRow; release: ReleaseReviewRow }): string {
    if (shouldPreferCitedRowDate(item)) {
        return formatDate(item.row.releaseYear, item.row.releaseMonth, item.row.releaseDay);
    }
    return formatDate(item.release.dateyear, item.release.datemonth, item.release.dateday);
}

function shouldPreferCitedRowDate(item: { row: CitedAlbumRow; release: ReleaseReviewRow }): boolean {
    return item.row.releaseYear !== null
        && item.release.dateyear !== null
        && item.row.releaseYear !== item.release.dateyear
        && !!item.row.releaseMonth;
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
