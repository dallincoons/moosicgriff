import {DBArtist} from "app/artists/artist";
import {db} from 'app/repositories/db';
import {Release} from "../../discography/release";

class Artists {
    async getAllWikilinks(): Promise<string[]> {
        const rows: Array<{ wikilink: string }> = await db`
            SELECT wikilink
            FROM artists
            WHERE wikilink IS NOT NULL
        `;

        return rows.map((row) => row.wikilink);
    }

    async getAll(): Promise<DBArtist[]> {
        const rows: DBArtist[] = await db`
            SELECT *
            FROM artists
            ORDER BY id ASC
        `;

        return rows;
    }

    async nextInQueue(runStartedAt: Date): Promise<DBArtist|undefined> {
        const [nextArtist]: [DBArtist?] = await db`
            SELECT *
            FROM artists
            WHERE peers_scraped_at IS NULL
               OR peers_scraped_at < ${runStartedAt.toISOString()}::timestamp
            ORDER BY
                CASE WHEN peers_scraped_at IS NULL THEN 0 ELSE 1 END ASC,
                CASE WHEN peers_scraped_at IS NULL THEN id END DESC,
                peers_scraped_at ASC NULLS LAST,
                id ASC
            LIMIT 1
        `

        return nextArtist
    }

    async getArtistByUrl(url: string): Promise<DBArtist|undefined> {
        const [artist]: [DBArtist?] = await db`
            SELECT * FROM artists
            WHERE wikilink = (${url})::text LIMIT 1
        `

        return artist
    }

    async getArtistByWikipediaPageId(wikipediaPageId: number): Promise<DBArtist|undefined> {
        const [artist]: [DBArtist?] = await db`
            SELECT * FROM artists
            WHERE wikipedia_page_id = ${wikipediaPageId}
            LIMIT 1
        `;

        return artist;
    }

    async markAsPeersFound(url: string) {
        await db`
            UPDATE artists
            SET found_peers = true,
                peers_scraped_at = CURRENT_TIMESTAMP
            WHERE wikilink = ${url}
        `
    }

    async updatePageContentHash(url: string, pageContentHash: string): Promise<void> {
        await db`
            UPDATE artists SET page_content_hash = ${pageContentHash} WHERE wikilink = ${url}
        `
    }

    async markAsDiscographyFound(url: string) {
        await db`
            UPDATE artists
            SET found_discography = true,
                discography_scraped_at = CURRENT_TIMESTAMP
            WHERE wikilink = ${url}
        `
    }

    async refreshHasMissingReleaseWikilinks(url: string): Promise<boolean> {
        const [row]: [{ has_missing_release_wikilinks: boolean }?] = await db`
            UPDATE artists a
            SET has_missing_release_wikilinks = EXISTS(
                SELECT 1
                FROM releases r
                WHERE lower(r.artist_wikilink) = lower(a.wikilink)
                  AND (
                    r.wikilink IS NULL
                    OR length(trim(r.wikilink)) = 0
                  )
            )
            WHERE a.wikilink = ${url}
            RETURNING has_missing_release_wikilinks
        `;

        return !!row?.has_missing_release_wikilinks;
    }

    async updateDiscographySourceState(
        url: string,
        discographyWikilink: string | null,
        discographyContentHash: string | null,
    ): Promise<void> {
        await db`
            UPDATE artists
            SET discography_wikilink = ${discographyWikilink}::text,
                discography_content_hash = ${discographyContentHash}::text
            WHERE wikilink = ${url}
        `
    }

    async resetAllFoundPeers(): Promise<void> {
        await db`
            UPDATE artists
            SET found_peers = false,
                peers_scraped_at = NULL
        `
    }

    async resetAllFoundDiscography(): Promise<void> {
        await db`
            UPDATE artists
            SET found_discography = false,
                discography_scraped_at = NULL
        `
    }

    async insertNew(name: string, url: string, parentUrl: string, wikipediaPageId: number | null = null) {
        await db`
                insert into artists
                    (artistname, wikilink, parent_wikilink, wikipedia_page_id)
                VALUES (${name}::text, ${url}::text, ${parentUrl}::text, ${wikipediaPageId}::bigint)
            `
    }

    async updateWikipediaIdentityById(id: number, wikilink: string, wikipediaPageId: number | null): Promise<void> {
        await db`
            UPDATE artists
            SET wikilink = ${wikilink}::text,
                wikipedia_page_id = ${wikipediaPageId}::bigint
            WHERE id = ${id}
        `;
    }

    async updateWikipediaPageIdById(id: number, wikipediaPageId: number | null): Promise<void> {
        await db`
            UPDATE artists
            SET wikipedia_page_id = ${wikipediaPageId}::bigint
            WHERE id = ${id}
        `;
    }

    async deleteById(id: number): Promise<void> {
        await db`
            DELETE FROM artists
            WHERE id = ${id}
        `;
    }

    async delete(url: string) {
        await db`DELETE FROM artists where wikilink = ${url}`
    }

    async getWhereDiscographyNotFound(runStartedAt: Date): Promise<DBArtist|undefined> {
        const [nextArtist]: [DBArtist?] = await db`
            SELECT *
            FROM artists
            WHERE discography_scraped_at IS NULL
               OR discography_scraped_at < ${runStartedAt.toISOString()}::timestamp
            ORDER BY discography_scraped_at ASC NULLS FIRST, id ASC
            LIMIT 1
        `

        return nextArtist
    }

    // Delete?
    async getWhereNotInDiscography(): Promise<DBArtist|undefined> {
        const [artist]: [DBArtist?] = await db`
            SELECT * FROM artists
            LEFT OUTER JOIN releases
            ON artists.id = releases.artist_id
            WHERE releases.artist_id IS NULL
            LIMIT 1
        `

        return artist;
    }
}

export default new Artists();
