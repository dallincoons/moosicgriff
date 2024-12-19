import {DBArtist} from "artists/artist";
import {db} from 'repositories/db';

export class Artists {
    async nextInQueue(): Promise<DBArtist> {
        const [nextArtist]: [DBArtist?] = await db`
            SELECT *
            FROM artists
            WHERE foundpeers = false
            LIMIT 1
        `

        return nextArtist
    }
}

