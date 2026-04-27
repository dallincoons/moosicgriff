import {getHtml, isMissingArticlePage} from "app/clients/wikipedia";
import discography from "app/repositories/discography/discography";
import discographyDeadlinks from "app/repositories/discographydeadlinks/discographydeadlinks";
import {db} from "app/repositories/db";
import * as cheerio from "cheerio";

type UnlinkedRow = {
    albumName: string;
    artistName: string;
};

type ReleaseRow = {
    title: string;
    original_title: string | null;
    artist_name: string;
    wikilink: string;
    artist_wikilink: string | null;
};

const UNLINKED_PAGE_OVERRIDES: Record<number, string[]> = {
    2021: [
        "https://en.wikipedia.org/wiki/List_of_2021_albums_(January%E2%80%93June)",
        "https://en.wikipedia.org/wiki/List_of_2021_albums_(July%E2%80%93December)",
    ],
};

export async function yearlyAlbumsUnlinked(yearArg?: string): Promise<void> {
    const year = parseInt(yearArg || "", 10);
    if (Number.isNaN(year) || year < 1900 || year > 2100) {
        console.log(`[yearly.albums.unlinked] invalid year "${yearArg}". example: yearly.albums.unlinked 2025`);
        return;
    }

    const pageUrls = buildUnlinkedSourcePages(year);
    console.log(`[yearly.albums.unlinked] scanning ${pageUrls.length} source page(s) for ${year}`);
    for (const pageUrl of pageUrls) {
        console.log(`[yearly.albums.unlinked] source=${pageUrl}`);
    }
    console.log(`[yearly.albums.unlinked] mode=db-only`);
    const rows: UnlinkedRow[] = [];
    const seenRowKeys = new Set<string>();
    for (const pageUrl of pageUrls) {
        const html = await getHtml(pageUrl);
        const pageRows = extractUnlinkedAlbumRows(html);
        for (const row of pageRows) {
            const key = `${normalizeTitleKey(row.artistName)}|${normalizeTitleKey(row.albumName)}`;
            if (seenRowKeys.has(key)) {
                continue;
            }
            seenRowKeys.add(key);
            rows.push(row);
        }
    }
    console.log(`[yearly.albums.unlinked] unlinked_rows=${rows.length}`);

    if (rows.length === 0) {
        return;
    }

    const releases = await loadReleasesForYear(year);
    let withSuggestion = 0;
    let skippedArtistRedirects = 0;
    let prunedDeletedReleaseLinks = 0;
    const suggestedRows: Array<{ row: UnlinkedRow; suggestedLink: string; source: string }> = [];
    const redirectCheckCache = new Map<string, boolean>();
    const missingArticleCache = new Map<string, boolean>();

    for (const row of rows) {
        const fromReleases = findReleaseSuggestion(row, releases, year);
        let suggestedLink = fromReleases?.wikilink || "";
        let source = fromReleases ? "releases" : "";

        if (suggestedLink) {
            const missing = await isMissingReleaseSuggestion(suggestedLink, missingArticleCache);
            if (missing) {
                await discography.clearReleaseLink(suggestedLink);
                await discographyDeadlinks.insertNew(suggestedLink);
                prunedDeletedReleaseLinks += 1;
                continue;
            }

            const artistWikilink = fromReleases?.artist_wikilink || "";
            const cacheKey = `${suggestedLink}|${artistWikilink}`;
            const redirectsToArtist = redirectCheckCache.has(cacheKey)
                ? !!redirectCheckCache.get(cacheKey)
                : await isRedirectToArtistPage(suggestedLink, artistWikilink);
            redirectCheckCache.set(cacheKey, redirectsToArtist);
            if (redirectsToArtist) {
                skippedArtistRedirects += 1;
                continue;
            }
            withSuggestion += 1;
            suggestedRows.push({ row, suggestedLink, source });
        }
    }

    for (const suggestion of suggestedRows) {
        console.log(`Album: ${suggestion.row.albumName}`);
        console.log(`Artist: ${suggestion.row.artistName || "(unknown)"}`);
        console.log(`Suggested Link: ${suggestion.suggestedLink}`);
        console.log(`Source: ${suggestion.source}`);
        console.log("");
    }

    console.log(`[yearly.albums.unlinked] suggestions=${withSuggestion}/${rows.length}`);
    if (prunedDeletedReleaseLinks > 0) {
        console.log(`[yearly.albums.unlinked] pruned_deleted_release_links=${prunedDeletedReleaseLinks}`);
    }
    if (skippedArtistRedirects > 0) {
        console.log(`[yearly.albums.unlinked] skipped_artist_redirects=${skippedArtistRedirects}`);
    }
}

function buildUnlinkedSourcePages(year: number): string[] {
    const overrides = UNLINKED_PAGE_OVERRIDES[year];
    if (overrides && overrides.length > 0) {
        return overrides;
    }
    return [`https://en.wikipedia.org/wiki/List_of_${year}_albums`];
}

function extractUnlinkedAlbumRows(html: string): UnlinkedRow[] {
    const $ = cheerio.load(html);
    const out: UnlinkedRow[] = [];
    const tables = $(".wikitable.plainrowheaders");

    tables.each((_, tableEl) => {
        const rows = $(tableEl).find("tr");
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

            const albumHref = albumCell.find('a[href^="/wiki/"]').first().attr("href");
            if (albumHref) {
                return;
            }

            const albumName = normalizeCellText(albumCell.text());
            const artistName = normalizeCellText(artistCell.text());
            if (!albumName) {
                return;
            }

            out.push({albumName, artistName});
        });
    });

    return out;
}

async function loadReleasesForYear(year: number): Promise<ReleaseRow[]> {
    const rows: ReleaseRow[] = await db`
        select title, original_title, artist_name, artist_wikilink, wikilink
        from releases
        where dateyear = ${year}
          and wikilink is not null
          and length(wikilink) > 0
    `;
    return rows;
}

async function isMissingReleaseSuggestion(wikilink: string, cache: Map<string, boolean>): Promise<boolean> {
    const normalized = (wikilink || "").trim();
    if (!normalized) {
        return true;
    }

    if (cache.has(normalized)) {
        return !!cache.get(normalized);
    }

    const missing = await isMissingArticlePage(normalized);
    cache.set(normalized, missing);
    return missing;
}

function findReleaseSuggestion(row: UnlinkedRow, releases: ReleaseRow[], year: number): ReleaseRow | null {
    const albumKey = normalizeTitleKey(row.albumName);
    const artistKey = normalizeArtistKey(row.artistName);
    const hasArtistText = (row.artistName || "").trim().length > 0;
    if (!albumKey) {
        return null;
    }

    let candidates = releases.filter((release) => {
        const titleKey = normalizeTitleKey(release.title);
        const originalTitleKey = normalizeTitleKey(stripReleaseDisambiguator(release.original_title || ""));
        return titleKey === albumKey || originalTitleKey === albumKey;
    });

    if (candidates.length === 0) {
        const inferred = inferredAlbumUrlCandidates(row.albumName, year);
        candidates = releases.filter((release) => {
            const releaseUrl = (release.wikilink || "").toLowerCase();
            return inferred.some((candidate) => releaseUrl === candidate.toLowerCase());
        });
    }

    if (candidates.length === 0) {
        return null;
    }

    if (!artistKey) {
        if (hasArtistText) {
            return null;
        }
        return candidates.length === 1 ? candidates[0] : null;
    }

    const artistMatched = candidates.filter((candidate) => {
        const candidateArtist = normalizeArtistKey(candidate.artist_name);
        return isLikelySameArtistKey(artistKey, candidateArtist);
    });

    if (artistMatched.length === 1) {
        return artistMatched[0];
    }

    return null;
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

function normalizeArtistKey(value: string): string {
    const tokens = ((value || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean);
    return tokens.join(" ").trim();
}

function isLikelySameArtistKey(inputArtistKey: string, candidateArtistKey: string): boolean {
    if (!inputArtistKey || !candidateArtistKey) {
        return false;
    }

    if (inputArtistKey === candidateArtistKey) {
        return true;
    }

    // Prevent one-word/short-token false positives like "o" matching "ngaiire".
    const shorterLength = Math.min(inputArtistKey.length, candidateArtistKey.length);
    if (shorterLength < 4) {
        return false;
    }

    return candidateArtistKey.includes(inputArtistKey) || inputArtistKey.includes(candidateArtistKey);
}

function stripReleaseDisambiguator(value: string): string {
    return (value || "")
        .replace(/\s+\((?:[^()]*\s)?album\)$/i, "")
        .replace(/\s+\((?:[^()]*\s)?ep\)$/i, "")
        .trim();
}

function inferredAlbumUrlCandidates(albumName: string, year: number): string[] {
    const base = albumName.trim().replace(/\s+/g, "_");
    const encodedBase = encodeURIComponent(base);
    return [
        `https://en.wikipedia.org/wiki/${encodedBase}`,
        `https://en.wikipedia.org/wiki/${encodeURIComponent(`${base}_(album)`)}`,
        `https://en.wikipedia.org/wiki/${encodeURIComponent(`${base}_(${year}_album)`)}`,
    ];
}

async function isRedirectToArtistPage(suggestedLink: string, artistWikilink: string): Promise<boolean> {
    const normalizedArtist = normalizeWikipediaArticleUrl(artistWikilink);
    if (!normalizedArtist) {
        return false;
    }

    const resolvedSuggested = await resolveWikipediaArticleUrl(suggestedLink);
    if (!resolvedSuggested) {
        return false;
    }

    return resolvedSuggested === normalizedArtist;
}

async function resolveWikipediaArticleUrl(pageUrl: string): Promise<string> {
    const pageTitle = wikipediaTitleFromUrl(pageUrl);
    if (!pageTitle) {
        return "";
    }

    const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(pageTitle)}`;
    const response = await fetch(apiUrl);
    if (!response.ok) {
        return "";
    }
    const data = await response.json() as {
        query?: {
            pages?: Array<{ title?: string; missing?: boolean }>;
        };
    };
    const page = data.query?.pages?.[0];
    if (!page || page.missing || !page.title) {
        return "";
    }

    return normalizeWikipediaArticleUrl(`https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/\s+/g, "_"))}`);
}

function normalizeWikipediaArticleUrl(url: string): string {
    const title = wikipediaTitleFromUrl(url);
    if (!title) {
        return "";
    }
    return title.toLowerCase();
}

function wikipediaTitleFromUrl(url: string): string {
    const input = (url || "").trim();
    if (!input) {
        return "";
    }

    try {
        const parsed = new URL(input);
        const rawPath = parsed.pathname.replace(/^\/wiki\//, "");
        const withoutFragment = rawPath.split("#")[0];
        return decodeURIComponent(withoutFragment).replace(/_/g, " ").trim();
    } catch (e) {
        const plain = input.replace(/^https?:\/\/[^/]+\/wiki\//i, "");
        const withoutFragment = plain.split("#")[0];
        try {
            return decodeURIComponent(withoutFragment).replace(/_/g, " ").trim();
        } catch (inner) {
            return withoutFragment.replace(/_/g, " ").trim();
        }
    }
}
