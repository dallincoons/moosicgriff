import {DBArtist} from "../../artists/artist";
import {db} from "../db";


class Deadlinks {
    async doesDeadLinkExist(link: string): Promise<boolean> {
        const [deadlink] = await db`
            SELECT * FROM deadlinks 
            WHERE link = (${link})::text LIMIT 1
        `

        return !!deadlink
    }

    async insertNew(link: string): Promise<void> {
        await db`
                insert into deadlinks 
                    (link)
                VALUES (${link}::text)
            `
    }
}

export default new Deadlinks();
