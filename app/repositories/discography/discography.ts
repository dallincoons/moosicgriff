import {db} from 'app/repositories/db';
import {DBRelease, Release} from "../../discography/release";
import {DBArtist} from "../../artists/artist";

const green = "\x1b[32m";
const reset = "\x1b[0m";

class Discography {
    async getReleaseByArtistAndLink(artistWikilink: string, releaseWikilink: string): Promise<DBRelease | undefined> {
        const [release]: [DBRelease?] = await db`
            SELECT *
            FROM releases
            WHERE artist_wikilink = ${artistWikilink}
            AND wikilink = ${releaseWikilink}
            LIMIT 1
        `;

        return release;
    }

    async getReleaseByWikipediaPageId(wikipediaPageId: number): Promise<DBRelease | undefined> {
        const [release]: [DBRelease?] = await db`
            SELECT *
            FROM releases
            WHERE wikipedia_page_id = ${wikipediaPageId}
            LIMIT 1
        `;

        return release;
    }

    async upsertRelease(release: Release, artist: DBArtist, contentHash: string) {
        if (!release.year) {
            console.error(`missing release year: ${artist.artistname}, ${release.name}`);
            return;
        }

        const originalReleaseType = release.type || "";
        const normalizedReleaseType = normalizeReleaseType(originalReleaseType);
        const existingByLink = await this.getReleaseByArtistAndLink(artist.wikilink, release.wikilink);
        const existingByPageId = release.wikipedia_page_id
            ? await this.getReleaseByWikipediaPageId(release.wikipedia_page_id)
            : undefined;
        const existing = existingByLink || existingByPageId;

        if (!existing) {
            await db`
                insert into releases
                    (
                        wikilink,
                        wikipedia_page_id,
                        artist_wikilink,
                        artist_name,
                        artist_display_name,
                        title,
                        original_title,
                        releasetype,
                        original_releasetype,
                        label,
                        genre,
                        original_genre,
                        recorded,
                        studio,
                        producer,
                        dateday,
                        datemonth,
                        dateyear,
                        content_hash,
                        number_of_reviews,
                        review_links
                    ) VALUES (
                        ${release.wikilink}::text,
                        ${release.wikipedia_page_id ?? null}::bigint,
                        ${artist.wikilink}::text,
                        ${(release.artist_name || artist.artistname)}::text,
                        ${(release.artist_display_name || release.artist_name || artist.artistname)}::text,
                        ${release.name}::text,
                        ${(release.original_title || release.name)}::text,
                        ${normalizedReleaseType}::text,
                        ${originalReleaseType}::text,
                        ${release.label}::text,
                        ${release.genre}::text,
                        ${release.original_genre}::text,
                        ${release.recorded}::text,
                        ${release.studio}::text,
                        ${release.producer}::text,
                        ${release.day}::integer,
                        ${release.month}::text,
                        ${release.year}::integer,
                        ${contentHash}::text,
                        ${release.number_of_reviews}::integer,
                        ${release.review_links}::text
                    )
            `;
            console.log(`${green}[discography] inserted album: ${release.name} (${release.wikilink})${reset}`);
            return;
        }

        await db`
            update releases
            set
                wikilink = ${release.wikilink}::text,
                wikipedia_page_id = ${release.wikipedia_page_id ?? null}::bigint,
                artist_name = ${(release.artist_name || artist.artistname)}::text,
                artist_display_name = ${(release.artist_display_name || release.artist_name || artist.artistname)}::text,
                title = ${release.name}::text,
                original_title = ${(release.original_title || release.name)}::text,
                releasetype = ${normalizedReleaseType}::text,
                original_releasetype = ${originalReleaseType}::text,
                label = ${release.label}::text,
                genre = ${release.genre}::text,
                original_genre = ${release.original_genre}::text,
                recorded = ${release.recorded}::text,
                studio = ${release.studio}::text,
                producer = ${release.producer}::text,
                dateday = ${release.day}::integer,
                datemonth = ${release.month}::text,
                dateyear = ${release.year}::integer,
                content_hash = ${contentHash}::text,
                number_of_reviews = ${release.number_of_reviews}::integer,
                review_links = ${release.review_links}::text,
                last_updated_at = CURRENT_TIMESTAMP
            where id = ${existing.id}
        `;
    }
}

export default new Discography();

function normalizeReleaseType(rawType: string): string {
    let normalized = (rawType || "").trim().toLowerCase();

    if (!normalized) {
        return "studio";
    }
    if (normalized === "single album") {
        return "single album";
    }
    if (normalized === "album") {
        return "studio";
    }
    if (normalized.endsWith(" album")) {
        normalized = normalized.replace(/\s+album$/, "").trim();
        if (!normalized) {
            normalized = "studio";
        }
    }
    if (normalized.includes("soundtrack")) {
        return "soundtrack";
    }
    if (normalized.includes("film")) {
        return "film";
    }
    if (normalized.includes("cast")) {
        return "cast";
    }
    if (normalized.includes("mixtape")) {
        return "mixtape";
    }
    if (normalized.includes("compilation")) {
        return "compilation";
    }
    if (normalized.includes("greatest")) {
        return "greatest";
    }
    if (normalized.includes("box")) {
        return "box";
    }
    if (normalized.includes("remix")) {
        return "remix";
    }
    if (normalized.includes("demo")) {
        return "demo";
    }
    if (normalized.includes("video")) {
        return "video";
    }
    if (normalized.includes("live")) {
        return "live";
    }
    if (normalized.includes("studio album") || normalized.includes("studio")) {
        return "studio";
    }
    if (normalized.includes("ep") || normalized.includes("extended play")) {
        return "EP";
    }

    return "studio";
}
