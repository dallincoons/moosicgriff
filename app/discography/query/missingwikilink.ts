import artists from "app/repositories/artists/artists";
import {db} from "app/repositories/db";
import {getHtml} from "app/clients/wikipedia";
import {isMissingArticlePage} from "app/clients/wikipedia";
import * as cheerio from "cheerio";

type ReleaseRow = {
    id: number;
    title: string;
    original_title: string | null;
    wikilink: string | null;
};

type UnlinkedAlbumReference = {
    albumName: string;
    normalizedTitleKey: string;
};

type AlbumOccurrence = {
    albumName: string;
    normalizedTitleKey: string;
    isLinked: boolean;
};

export async function discographyMissingWikilink(artistUrlArg?: string): Promise<void> {
    const artistRows = artistUrlArg
        ? (await artists.getAll()).filter((artist) => equalsIgnoreCase(artist.wikilink, artistUrlArg))
        : await artists.getAll();

    if (artistUrlArg && artistRows.length === 0) {
        console.log(`[discography.missing.link] artist not found: ${artistUrlArg}`);
        return;
    }

    console.log(`[discography.missing.link] scanning_artists=${artistRows.length}`);

    for (const artist of artistRows) {
        console.log(`[discography.missing.link] checking artist=${artist.artistname} url=${artist.wikilink}`);
        const sourcePage = await getDiscographySourcePageForArtist(
            artist.wikilink,
            artist.discography_wikilink || null,
        );
        const sourceHtml = await getHtml(sourcePage);
        const unlinkedReferences = extractUnlinkedAlbumReferences(sourceHtml);
        if (unlinkedReferences.length === 0) {
            continue;
        }

        const releases = await loadReleaseRowsForArtist(artist.wikilink, artist.artistname);
        const releaseIndex = buildReleaseTitleIndex(releases);
        const matchedUnlinked = findMatchedUnlinkedAlbums(unlinkedReferences, releaseIndex);
        if (matchedUnlinked.length === 0) {
            continue;
        }

        console.log(`[discography.missing.link] artist=${artist.artistname}`);
        console.log(`[discography.missing.link] artist_wikilink=${artist.wikilink}`);
        console.log(`[discography.missing.link] source_page=${sourcePage}`);
        console.log(`[discography.missing.link] matched_unlinked_albums=${matchedUnlinked.length}`);
        for (const match of matchedUnlinked) {
            console.log(`Source Page: ${sourcePage}`);
            console.log(`Missing Release: ${match.albumName}`);
            console.log(`Recommended Wikilink: ${match.recommendedWikilink || "(no wikilink in releases row)"}`);
            console.log("Reason: album name is unlinked on page and a matching release exists in the database");
            console.log("");
        }
        return;
    }

    console.log("[discography.missing.link] no artists found with unlinked album names that match releases.");
}

async function getDiscographySourcePageForArtist(
    artistWikilink: string,
    knownDiscographyWikilink: string | null,
): Promise<string> {
    const candidates = buildDiscographyPageCandidates(artistWikilink, knownDiscographyWikilink);
    for (const candidate of candidates) {
        if (!(await isMissingArticlePage(candidate))) {
            return candidate;
        }
    }

    return artistWikilink;
}

function buildDiscographyPageCandidates(artistWikilink: string, knownDiscographyWikilink: string | null): string[] {
    const out: string[] = [];
    const pushUnique = (value: string) => {
        const normalized = (value || "").trim();
        if (!normalized || out.includes(normalized)) {
            return;
        }
        out.push(normalized);
    };

    if (knownDiscographyWikilink && isDiscographyPageUrl(knownDiscographyWikilink)) {
        pushUnique(knownDiscographyWikilink);
    }

    pushUnique(`${artistWikilink}_discography`);

    const canonicalArtist = artistWikilink
        .replace(/\s*\/?wiki\//i, "/wiki/")
        .replace(/_?\([^)]*\)$/i, "");
    pushUnique(`${canonicalArtist}_discography`);

    return out;
}

function isDiscographyPageUrl(url: string): boolean {
    const normalized = decodeURIComponent((url || "").toLowerCase());
    return normalized.includes("/wiki/") && normalized.includes("_discography");
}

async function loadReleaseRowsForArtist(artistWikilink: string, artistName: string): Promise<ReleaseRow[]> {
    const rows: ReleaseRow[] = await db`
        select id, title, original_title, wikilink
        from releases
        where lower(coalesce(artist_wikilink, '')) = lower(${artistWikilink})
           or lower(coalesce(artist_name, '')) = lower(${artistName})
           or lower(coalesce(artist_display_name, '')) = lower(${artistName})
        order by dateyear asc nulls first, datemonth asc, dateday asc nulls first, title asc
    `;
    return rows;
}

function buildReleaseTitleIndex(releases: ReleaseRow[]): Map<string, ReleaseRow[]> {
    const out = new Map<string, ReleaseRow[]>();
    for (const release of releases) {
        const keys = new Set<string>();
        keys.add(normalizeTitleKey(release.title || ""));
        keys.add(normalizeTitleKey(release.original_title || ""));

        for (const key of keys) {
            if (!key) {
                continue;
            }

            const existing = out.get(key) || [];
            existing.push(release);
            out.set(key, existing);
        }
    }
    return out;
}

function findMatchedUnlinkedAlbums(
    references: UnlinkedAlbumReference[],
    releaseIndex: Map<string, ReleaseRow[]>,
) : Array<{ albumName: string; recommendedWikilink: string }> {
    const out: Array<{ albumName: string; recommendedWikilink: string }> = [];
    for (const reference of references) {
        const matches = releaseIndex.get(reference.normalizedTitleKey) || [];
        if (matches.length === 0) {
            continue;
        }
        const preferred = matches.find((row) => !!(row.wikilink || "").trim()) || matches[0];
        out.push({
            albumName: reference.albumName,
            recommendedWikilink: (preferred?.wikilink || "").trim(),
        });
    }
    return out;
}

function extractUnlinkedAlbumReferences(html: string): UnlinkedAlbumReference[] {
    const $ = cheerio.load(html);
    const occurrences: AlbumOccurrence[] = [];
    const root = $("#mw-content-text .mw-parser-output").first();
    const scope = root.length ? root : $("body").first();
    let inAlbumSection = false;

    scope.children().each((_, node) => {
        const el = $(node);

        if (el.is("h1,h2,h3,h4,h5,h6")) {
            const heading = normalizeCellText(el.text()).toLowerCase();
            const isDiscographyLike = /discography|album/.test(heading);
            const isNonAlbumSection = /single|video|film|references|notes|external links/.test(heading);
            inAlbumSection = isDiscographyLike && !isNonAlbumSection;
            return;
        }

        if (!inAlbumSection) {
            return;
        }

        el.find("table.wikitable").addBack("table.wikitable").each((__, tableEl) => {
            const table = $(tableEl);
            const headerText = normalizeCellText(table.find("tr").first().text()).toLowerCase();
            if (!/(title|album details|released|label|format)/.test(headerText)) {
                return;
            }

            const rows = table.find("tr");
            rows.each((rowIndex, rowEl) => {
                if (rowIndex === 0) {
                    return;
                }

                const cells = $(rowEl).children("th,td");
                if (cells.length < 2) {
                    return;
                }

                const firstCell = cells.eq(0);
                const albumName = normalizeCellText(firstCell.text());
                if (!isPossibleAlbumName(albumName)) {
                    return;
                }
                const albumKey = normalizeTitleKey(albumName);
                if (!albumKey) {
                    return;
                }

                const rightSideText = normalizeCellText(cells.slice(1).text()).toLowerCase();
                if (!isLikelyDiscographyRow(rightSideText)) {
                    return;
                }

                const isLinked = cellHasArticleLink($, firstCell) || rowHasMatchingArticleLink($, $(rowEl), albumKey);
                occurrences.push({ albumName, normalizedTitleKey: albumKey, isLinked });
            });
        });
    });

    // Fallback list handling for pages that use plain list discographies.
    scope.children().each((_, node) => {
        const el = $(node);
        if (el.is("h1,h2,h3,h4,h5,h6")) {
            const heading = normalizeCellText(el.text()).toLowerCase();
            const isDiscographyLike = /discography|album/.test(heading);
            const isNonAlbumSection = /single|video|film|references|notes|external links/.test(heading);
            inAlbumSection = isDiscographyLike && !isNonAlbumSection;
            return;
        }
        if (!inAlbumSection || !el.is("ul")) {
            return;
        }
        el.children("li").each((__, liEl) => {
            const li = $(liEl);
            const text = normalizeCellText(li.text());
            const parsedAlbumName = parseAlbumNameFromListItem(text);
            if (!parsedAlbumName || !isPossibleAlbumName(parsedAlbumName)) {
                return;
            }

            const key = normalizeTitleKey(parsedAlbumName);
            if (!key) {
                return;
            }

            const isLinked = rowHasMatchingArticleLink($, li, key);
            occurrences.push({ albumName: parsedAlbumName, normalizedTitleKey: key, isLinked });
        });
    });

    const firstByKey = new Map<string, AlbumOccurrence>();
    for (const occurrence of occurrences) {
        if (!firstByKey.has(occurrence.normalizedTitleKey)) {
            firstByKey.set(occurrence.normalizedTitleKey, occurrence);
        }
    }

    const out: UnlinkedAlbumReference[] = [];
    for (const occurrence of firstByKey.values()) {
        if (!occurrence.isLinked) {
            out.push({
                albumName: occurrence.albumName,
                normalizedTitleKey: occurrence.normalizedTitleKey,
            });
        }
    }

    return out;
}

function isPossibleAlbumName(value: string): boolean {
    if (!value) {
        return false;
    }

    const normalized = value.toLowerCase();
    if (normalized.length > 120) {
        return false;
    }
    if (normalized.includes("released:") || normalized.includes("label:") || normalized.includes("format:")) {
        return false;
    }
    const blocked = [
        "title",
        "album",
        "albums",
        "year",
        "details",
        "release date",
        "notes",
        "chart",
        "sales",
    ];
    if (blocked.includes(normalized)) {
        return false;
    }

    return true;
}

function isLikelyDiscographyRow(rowDetailsText: string): boolean {
    return /released|label|format|chart|sales|certif/i.test(rowDetailsText);
}

function parseAlbumNameFromListItem(value: string): string {
    const cleaned = normalizeCellText(value);
    if (!cleaned) {
        return "";
    }

    // Strict list form: "Album Name (2018)".
    const yearSuffixMatch = cleaned.match(/^(.+?)\s+\((?:19|20)\d{2}\)$/);
    if (yearSuffixMatch && yearSuffixMatch[1]) {
        return yearSuffixMatch[1].trim();
    }

    return "";
}

function cellHasArticleLink($: cheerio.CheerioAPI, node: cheerio.Cheerio<any>): boolean {
    const anchors = node.find("a[href]");
    for (let i = 0; i < anchors.length; i++) {
        const href = ($(anchors[i]).attr("href") || "").trim();
        if (isArticleHref(href)) {
            return true;
        }
    }
    return false;
}

function rowHasMatchingArticleLink($: cheerio.CheerioAPI, rowNode: cheerio.Cheerio<any>, albumKey: string): boolean {
    const anchors = rowNode.find("a[href]");
    for (let i = 0; i < anchors.length; i++) {
        const anchor = $(anchors[i]);
        const href = (anchor.attr("href") || "").trim();
        if (!isArticleHref(href)) {
            continue;
        }
        const anchorTextKey = normalizeTitleKey(normalizeCellText(anchor.text()));
        if (anchorTextKey && anchorTextKey === albumKey) {
            return true;
        }
    }
    return false;
}

function isArticleHref(href: string): boolean {
    if (!href) {
        return false;
    }

    // Wikipedia article links can appear as /wiki/Title or ./Title in rendered tables.
    if (href.startsWith("/wiki/")) {
        return !href.includes(":") && !href.includes("#");
    }
    if (href.startsWith("./")) {
        return !href.includes(":") && !href.includes("#");
    }
    return false;
}

function normalizeCellText(value: string): string {
    return (value || "")
        .replace(/\[[0-9]+\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeTitleKey(value: string): string {
    return stripReleaseDisambiguator((value || ""))
        .toLowerCase()
        .replace(/['’"]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function stripReleaseDisambiguator(value: string): string {
    return (value || "")
        .replace(/\s+\((?:[^()]*\s)?album\)$/i, "")
        .replace(/\s+\((?:[^()]*\s)?ep\)$/i, "")
        .trim();
}

function equalsIgnoreCase(a: string, b: string): boolean {
    return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}
