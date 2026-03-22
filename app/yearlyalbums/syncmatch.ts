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
