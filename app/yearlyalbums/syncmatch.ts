export function normalizeWikipediaUrl(url: string): string {
    const trimmed = (url || "").trim().replace(/#.*$/, "");
    try {
        const parsed = new URL(trimmed);
        const decodedPath = decodeURIComponent(parsed.pathname);
        return `${parsed.protocol}//${parsed.host}${decodedPath}`.toLowerCase();
    } catch (e) {
        try {
            return decodeURIComponent(trimmed).toLowerCase();
        } catch (inner) {
            return trimmed.toLowerCase();
        }
    }
}

export function normalizeWikipediaArticleHref(href: string): string {
    const trimmed = (href || "").trim();
    if (!trimmed) {
        return "";
    }

    if (trimmed.startsWith("/wiki/")) {
        return `https://en.wikipedia.org${trimmed}`;
    }

    if (trimmed.startsWith("//en.wikipedia.org/wiki/")) {
        return `https:${trimmed}`;
    }

    if (/^https?:\/\/en\.wikipedia\.org\/wiki\//i.test(trimmed)) {
        return trimmed.replace(/^http:\/\//i, "https://");
    }

    return "";
}

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

export function isSkippableWikipediaHref(href: string): boolean {
    const normalizedHref = normalizeWikipediaArticleHref(href);
    if (!normalizedHref || normalizedHref.includes("#")) {
        return true;
    }

    let rawTitle = "";
    try {
        rawTitle = new URL(normalizedHref).pathname.slice("/wiki/".length);
    } catch {
        return true;
    }

    if (!rawTitle) {
        return true;
    }

    let decodedTitle = rawTitle;
    try {
        decodedTitle = decodeURIComponent(rawTitle);
    } catch {
        decodedTitle = rawTitle;
    }

    const namespaceSeparator = decodedTitle.indexOf(":");
    if (namespaceSeparator < 0) {
        return false;
    }

    const namespace = decodedTitle.slice(0, namespaceSeparator).replace(/_/g, " ").trim().toLowerCase();
    return WIKIPEDIA_NAMESPACES.has(namespace);
}

export function shouldProcessEntry(
    artistWikilink: string,
    albumWikilink: string,
    artistWikilinks: Set<string>,
    releaseArtistWikilinks: Set<string>,
    releaseArtistByAlbumUrl: Map<string, string>,
): boolean {
    const normalizedArtistWikilink = normalizeWikipediaUrl(artistWikilink);
    if (artistWikilinks.has(normalizedArtistWikilink) || releaseArtistWikilinks.has(normalizedArtistWikilink)) {
        return true;
    }

    const normalizedAlbumWikilink = normalizeWikipediaUrl(albumWikilink);
    return releaseArtistByAlbumUrl.has(normalizedAlbumWikilink);
}
