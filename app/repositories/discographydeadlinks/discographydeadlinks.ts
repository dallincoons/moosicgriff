import {db} from "app/repositories/db";

class DiscographyDeadlinks {
    async doesDeadLinkExist(link: string): Promise<boolean> {
        const [deadlink] = await db`
            SELECT *
            FROM discography_deadlinks
            WHERE link = ${link}::text
            LIMIT 1
        `;

        return !!deadlink;
    }

    async insertNew(link: string): Promise<void> {
        await db`
            INSERT INTO discography_deadlinks (link, checked_at)
            VALUES (${link}::text, CURRENT_TIMESTAMP)
            ON CONFLICT (link) DO UPDATE
            SET checked_at = CURRENT_TIMESTAMP
        `;
    }
}

export default new DiscographyDeadlinks();
