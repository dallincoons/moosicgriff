import {db} from "app/repositories/db";
import {YearlyAlbumReference} from "app/yearlyalbums/reference";

class YearlyAlbumsRepository {
    async upsert(reference: YearlyAlbumReference): Promise<void> {
        await db`
            insert into yearly_album_references
                (
                    album_name,
                    album_wikilink,
                    wikipedia_page_id,
                    release_year,
                    release_month,
                    release_day,
                    genre,
                    record_label,
                    source_list_wikilink
                )
            values (
                ${reference.album_name}::text,
                ${reference.album_wikilink}::text,
                ${reference.wikipedia_page_id}::bigint,
                ${reference.release_year}::integer,
                ${reference.release_month}::text,
                ${reference.release_day}::integer,
                ${reference.genre}::text,
                ${reference.record_label}::text,
                ${reference.source_list_wikilink}::text
            )
            on conflict (source_list_wikilink, album_wikilink)
            do update set
                album_name = excluded.album_name,
                wikipedia_page_id = excluded.wikipedia_page_id,
                release_year = excluded.release_year,
                release_month = excluded.release_month,
                release_day = excluded.release_day,
                genre = excluded.genre,
                record_label = excluded.record_label
        `;
    }

    async deleteMissingForSource(sourceListWikilink: string, albumWikilinks: string[]): Promise<number> {
        if (albumWikilinks.length === 0) {
            const deleted = await db`
                delete from yearly_album_references
                where source_list_wikilink = ${sourceListWikilink}
                returning id
            `;
            return deleted.length;
        }

        const deleted = await db`
            delete from yearly_album_references
            where source_list_wikilink = ${sourceListWikilink}
              and album_wikilink not in ${db(albumWikilinks)}
            returning id
        `;
        return deleted.length;
    }
}

export default new YearlyAlbumsRepository();
