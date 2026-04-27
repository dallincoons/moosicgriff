import {db} from "app/repositories/db";
import {DBLabel, Label} from "app/labels/label";

class Labels {
    async upsertLabel(label: Label): Promise<void> {
        await db`
            insert into labels
                (
                    wikilink,
                    wikipedia_page_id,
                    name,
                    founded,
                    country_of_origin,
                    genre,
                    founder,
                    last_scraped_at
                ) values (
                    ${label.wikilink}::text,
                    ${label.wikipedia_page_id ?? null}::bigint,
                    ${label.name}::text,
                    ${label.founded}::text,
                    ${label.country_of_origin}::text,
                    ${label.genre}::text,
                    ${label.founder}::text,
                    CURRENT_TIMESTAMP
                )
            on conflict (wikilink)
            do update
            set
                wikipedia_page_id = excluded.wikipedia_page_id,
                name = excluded.name,
                founded = excluded.founded,
                country_of_origin = excluded.country_of_origin,
                genre = excluded.genre,
                founder = excluded.founder,
                last_scraped_at = CURRENT_TIMESTAMP
        `;
    }

    async getAll(limit?: number): Promise<DBLabel[]> {
        return limit && limit > 0
            ? await db`
                select *
                from labels
                order by name asc
                limit ${limit}
            `
            : await db`
                select *
                from labels
                order by name asc
            `;
    }
}

export default new Labels();
