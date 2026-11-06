import * as cheerio from "cheerio";
import {isSkippableWikipediaHref, normalizeWikipediaArticleHref} from "app/yearlyalbums/syncmatch";

export type YearlyListEntry = {
    artistWikilink: string;
    albumWikilink: string;
    albumName: string;
    genre: string;
    recordLabel: string;
    releaseYear: number | null;
    releaseMonth: string;
    releaseDay: number | null;
};

type YearlyTableColumns = {
    headerRowIndex: number;
    headerWidth: number;
    artistIndex: number;
    albumIndex: number;
    genreIndex: number;
    labelIndex: number;
};

type ActiveRowspanArtist = {
    wikilink: string;
    remainingRows: number;
};

export function extractAlbumEntriesFromYearlyListHtml(sourcePageUrl: string, html: string): YearlyListEntry[] {
    const $ = cheerio.load(html);
    const entries: YearlyListEntry[] = [];
    const tables = selectYearlyAlbumTables($, sourcePageUrl);
    const releaseYear = parseYearFromSourceListUrl(sourcePageUrl);

    tables.each((_, tableEl) => {
        const rows = $(tableEl).find("tr");
        const columns = detectYearlyAlbumTableColumns($, rows);
        let activeMonth = "";
        let activeDay: number | null = null;
        let activeRowspanArtist: ActiveRowspanArtist | null = null;

        rows.each((rowIndex, rowEl) => {
            if (rowIndex <= columns.headerRowIndex) {
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
            const firstIsDateHeader = isDateHeaderCell(firstCell);
            const fallbackArtistCell = firstIsDateHeader ? cells.eq(1) : cells.eq(0);
            const fallbackAlbumCell = firstIsDateHeader ? cells.eq(2) : cells.eq(1);
            const fallbackGenreCell = firstIsDateHeader ? cells.eq(3) : cells.eq(2);
            const fallbackLabelCell = firstIsDateHeader ? cells.eq(4) : cells.eq(3);
            const artistCell = hasColumnIndex(cells, resolvedArtistIndex) ? cells.eq(resolvedArtistIndex) : fallbackArtistCell;
            const albumCell = hasColumnIndex(cells, resolvedAlbumIndex) ? cells.eq(resolvedAlbumIndex) : fallbackAlbumCell;
            const genreCell = hasColumnIndex(cells, resolvedGenreIndex) ? cells.eq(resolvedGenreIndex) : fallbackGenreCell;
            const labelCell = hasColumnIndex(cells, resolvedLabelIndex) ? cells.eq(resolvedLabelIndex) : fallbackLabelCell;

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

            const albumHref = firstWikipediaArticleHref(albumCell);
            const artistCellIsRowspanPlaceholder = Boolean(
                activeRowspanArtist
                && resolvedArtistIndex >= 0
                && resolvedArtistIndex === resolvedAlbumIndex,
            );
            const explicitArtistHref = artistCellIsRowspanPlaceholder
                ? ""
                : firstWikipediaArticleHref(artistCell);
            const artistHref = explicitArtistHref || activeRowspanArtist?.wikilink || "";
            if (!albumHref) {
                decrementRowspanArtist();
                return;
            }
            if (isSkippableWikipediaHref(albumHref)) {
                decrementRowspanArtist();
                return;
            }
            if (artistHref && isSkippableWikipediaHref(artistHref)) {
                decrementRowspanArtist();
                return;
            }

            entries.push({
                artistWikilink: artistHref ? normalizeWikipediaArticleHref(artistHref) : "",
                albumWikilink: normalizeWikipediaArticleHref(albumHref),
                albumName: normalizeCellText(albumCell.text()),
                genre: normalizeCellText(genreCell.text()),
                recordLabel: normalizeCellText(labelCell.text()),
                releaseYear,
                releaseMonth: activeMonth,
                releaseDay: activeDay,
            });

            const artistRowspan = parseRowspan(artistCell.attr("rowspan"));
            if (explicitArtistHref && artistRowspan > 1) {
                activeRowspanArtist = {
                    wikilink: explicitArtistHref,
                    remainingRows: artistRowspan,
                };
            }
            decrementRowspanArtist();
        });

        function decrementRowspanArtist(): void {
            if (!activeRowspanArtist) {
                return;
            }
            activeRowspanArtist.remainingRows -= 1;
            if (activeRowspanArtist.remainingRows <= 0) {
                activeRowspanArtist = null;
            }
        }
    });

    return entries;
}

function firstWikipediaArticleHref(cell: cheerio.Cheerio<any>): string {
    const anchors = cell.find("a[href]");
    for (let i = 0; i < anchors.length; i++) {
        const href = anchors.eq(i).attr("href") || "";
        if (normalizeWikipediaArticleHref(href)) {
            return href;
        }
    }
    return "";
}

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
    const headingContainer = heading.parent().is("div.mw-heading") ? heading.parent() : heading;
    let cursor = headingContainer.next();
    while (cursor.length) {
        if (isLegacySectionBoundary(cursor)) {
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

function isLegacySectionBoundary(node: cheerio.Cheerio<any>): boolean {
    if (node.is("h2")) {
        return true;
    }

    if (node.is("div.mw-heading")) {
        const className = node.attr("class") || "";
        if (/\bmw-heading2\b/.test(className)) {
            return true;
        }
        const childHeading = node.children("h2");
        if (childHeading.length > 0) {
            return true;
        }
    }

    return false;
}

function detectYearlyAlbumTableColumns($: cheerio.CheerioAPI, rows: cheerio.Cheerio<any>): YearlyTableColumns {
    let fallbackLabels: string[] = [];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const headerCells = rows.eq(rowIndex).children("th,td");
        const labels = headerCells
            .toArray()
            .map((cell) => normalizeCellText($(cell).text()).toLowerCase());

        if (rowIndex === 0) {
            fallbackLabels = labels;
        }

        const artistIndex = findColumnIndex(labels, ["artist", "artists", "performer"]);
        const albumIndex = findColumnIndex(labels, ["album", "title"]);
        if (artistIndex >= 0 && albumIndex >= 0) {
            return {
                headerRowIndex: rowIndex,
                headerWidth: Math.max(1, headerCells.length),
                artistIndex,
                albumIndex,
                genreIndex: findColumnIndex(labels, ["genre"]),
                labelIndex: findColumnIndex(labels, ["label", "record label"]),
            };
        }
    }

    return {
        headerRowIndex: 0,
        headerWidth: Math.max(1, fallbackLabels.length),
        artistIndex: findColumnIndex(fallbackLabels, ["artist", "artists", "performer"]),
        albumIndex: findColumnIndex(fallbackLabels, ["album", "title"]),
        genreIndex: findColumnIndex(fallbackLabels, ["genre"]),
        labelIndex: findColumnIndex(fallbackLabels, ["label", "record label"]),
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

function isDateHeaderCell(cell: cheerio.Cheerio<any>): boolean {
    if (!cell.is("th") || cell.attr("scope") !== "row") {
        return false;
    }

    const parsedDate = parseReleaseDateFromCellText(cell.text());
    return Boolean(parsedDate.month || parsedDate.day !== null);
}

function parseReleaseDateFromCellText(value: string): { month: string; day: number | null } {
    const normalized = normalizeCellText(value).replace(/([A-Za-z])([0-9])/g, "$1 $2");
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

function parseRowspan(value?: string): number {
    if (!value) {
        return 1;
    }

    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function capitalize(value: string): string {
    if (!value) {
        return "";
    }
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
