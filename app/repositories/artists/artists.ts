import {DBArtist} from "app/artists/artist";
import {db} from 'app/repositories/db';

class Artists {
    async nextInQueue(): Promise<DBArtist|undefined> {
        const [nextArtist]: [DBArtist?] = await db`
            SELECT *
            FROM artists
            WHERE foundpeers = false
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
            UPDATE artists SET foundpeers = true WHERE wikilink = ${url}
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
}

export default new Artists();

