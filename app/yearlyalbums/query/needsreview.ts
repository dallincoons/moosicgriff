import yearlyAlbums from "app/repositories/yearlyalbums/yearlyalbums";
import {getPrimaryYearlyAlbumSourceWikilink} from "app/yearlyalbums/sourcepages";

export async function yearlyAlbumsNeedsReviewMark(yearArg?: string, albumWikilinkArg?: string): Promise<void> {
    const year = parseYear(yearArg);
    if (year === null) {
        console.log(`[yearly.albums.needs_review.mark] invalid year "${yearArg}"`);
        return;
    }
    const albumWikilink = (albumWikilinkArg || "").trim();
    if (!albumWikilink) {
        console.log("[yearly.albums.needs_review.mark] missing album_wikilink argument");
        return;
    }

    const sourceListWikilink = getPrimaryYearlyAlbumSourceWikilink(year);
    const updated = await yearlyAlbums.markNeedsReview(sourceListWikilink, albumWikilink, true);
    console.log(
        `[yearly.albums.needs_review.mark] source=${sourceListWikilink} album=${albumWikilink} updated=${updated}`,
    );
}

export async function yearlyAlbumsNeedsReviewList(yearArg?: string): Promise<void> {
    const year = yearArg ? parseYear(yearArg) : undefined;
    if (yearArg && year === null) {
        console.log(`[yearly.albums.needs_review.list] invalid year "${yearArg}"`);
        return;
    }

    const rows = await yearlyAlbums.getNeedsReview(year ?? undefined);
    console.log(
        `[yearly.albums.needs_review.list] year=${year ?? "all"} count=${rows.length}`,
    );
    for (const row of rows) {
        console.log(`Album: ${row.album_name}`);
        console.log(`Artist: ${row.artist_name || "(unknown)"}`);
        console.log(`List: ${row.source_list_wikilink}`);
        console.log(`Wikilink: ${row.album_wikilink}`);
        console.log("");
    }
}

function parseYear(yearArg?: string): number | null {
    const year = parseInt(yearArg || "", 10);
    if (Number.isNaN(year) || year < 1900 || year > 2100) {
        return null;
    }
    return year;
}
