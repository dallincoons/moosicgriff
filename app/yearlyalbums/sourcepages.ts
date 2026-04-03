export const DEFAULT_YEARLY_ALBUM_SYNC_START_YEAR = 2005;
export const MIN_YEARLY_ALBUM_YEAR = 1900;

const YEARLY_ALBUM_PAGE_OVERRIDES: Record<number, string[]> = {
    2021: [
        "https://en.wikipedia.org/wiki/List_of_2021_albums_(January%E2%80%93June)",
        "https://en.wikipedia.org/wiki/List_of_2021_albums_(July%E2%80%93December)",
    ],
};

export function buildYearlyAlbumSourcePages(year: number): string[] {
    if (year <= 2004) {
        return [buildLegacyInMusicPageUrl(year)];
    }

    const overrides = YEARLY_ALBUM_PAGE_OVERRIDES[year];
    if (overrides && overrides.length > 0) {
        return overrides;
    }

    return [buildListOfAlbumsPageUrl(year)];
}

export function getPrimaryYearlyAlbumSourceWikilink(year: number): string {
    return buildYearlyAlbumSourcePages(year)[0];
}

export function buildListOfAlbumsPageUrl(year: number): string {
    return `https://en.wikipedia.org/wiki/List_of_${year}_albums`;
}

export function buildLegacyInMusicPageUrl(year: number): string {
    return `https://en.wikipedia.org/wiki/${year}_in_music`;
}
