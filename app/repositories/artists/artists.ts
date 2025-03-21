import {DBArtist} from "app/artists/artist";
import {db} from 'app/repositories/db';
import {Release} from "../../discography/release";

class Artists {
    async nextInQueue(): Promise<DBArtist|undefined> {
        const [nextArtist]: [DBArtist?] = await db`
            SELECT *
            FROM artists
            WHERE found_peers = false
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

    async markAsPeersFound(url: string) {
        await db`
            UPDATE artists SET found_peers = true WHERE wikilink = ${url}
        `
    }

    async markAsDiscographyFound(url: string) {
        await db`
            UPDATE artists SET found_discography = true WHERE wikilink = ${url}
        `
    }

    async insertNew(name: string, url: string, parentUrl: string) {
        await db`
                insert into artists
                    (artistname, wikilink, parent_wikilink)
                VALUES (${name}::text, ${url}::text, ${parentUrl}::text)
            `
    }

    async delete(url: string) {
        await db`DELETE FROM artists where wikilink = ${url}`
    }

    async getWhereDiscographyNotFound(): Promise<DBArtist|undefined> {
        const [nextArtist]: [DBArtist?] = await db`
            SELECT *
            FROM artists
            WHERE found_discography = false
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

