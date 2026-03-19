import {DBArtist} from "../../artists/artist";
import {db} from "../db";


class Deadlinks {
    async doesDeadLinkExist(link: string): Promise<boolean> {
        const [deadlink] = await db`
            SELECT * FROM artist_deadlinks
            WHERE link = (${link})::text LIMIT 1
        `

        return !!deadlink
    }

    async insertNew(link: string): Promise<void> {
        await db`
                insert into artist_deadlinks
                    (link)
                VALUES (${link}::text)
            `
    }
}

export default new Deadlinks();
