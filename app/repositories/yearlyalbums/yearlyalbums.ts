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
                    needs_review,
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
                ${reference.needs_review ?? false}::boolean,
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

    async markNeedsReview(sourceListWikilink: string, albumWikilink: string, needsReview: boolean): Promise<number> {
        const updated = await db`
            update yearly_album_references
            set needs_review = ${needsReview}::boolean
            where source_list_wikilink = ${sourceListWikilink}
              and lower(album_wikilink) = lower(${albumWikilink})
            returning id
        `;
        return updated.length;
    }

    async getNeedsReview(year?: number): Promise<Array<{
        id: number;
        source_list_wikilink: string;
        album_name: string;
        album_wikilink: string;
        wikipedia_page_id: number | null;
        release_year: number | null;
        release_month: string;
        release_day: number | null;
        artist_name: string | null;
    }>> {
        const sourceFilter = year
            ? `https://en.wikipedia.org/wiki/List_of_${year}_albums`
            : null;

        const rows = sourceFilter
            ? await db`
                select
                    yar.id,
                    yar.source_list_wikilink,
                    yar.album_name,
                    yar.album_wikilink,
                    yar.wikipedia_page_id,
                    yar.release_year,
                    yar.release_month,
                    yar.release_day,
                    r.artist_name
                from yearly_album_references yar
                left join releases r
                  on (yar.wikipedia_page_id is not null and r.wikipedia_page_id = yar.wikipedia_page_id)
                  or (yar.wikipedia_page_id is null and lower(r.wikilink) = lower(yar.album_wikilink))
                where yar.needs_review = true
                  and yar.source_list_wikilink = ${sourceFilter}
                order by yar.release_year asc nulls first, yar.release_month asc, yar.release_day asc nulls first, yar.album_name asc
              `
            : await db`
                select
                    yar.id,
                    yar.source_list_wikilink,
                    yar.album_name,
                    yar.album_wikilink,
                    yar.wikipedia_page_id,
                    yar.release_year,
                    yar.release_month,
                    yar.release_day,
                    r.artist_name
                from yearly_album_references yar
                left join releases r
                  on (yar.wikipedia_page_id is not null and r.wikipedia_page_id = yar.wikipedia_page_id)
                  or (yar.wikipedia_page_id is null and lower(r.wikilink) = lower(yar.album_wikilink))
                where yar.needs_review = true
                order by yar.release_year asc nulls first, yar.release_month asc, yar.release_day asc nulls first, yar.album_name asc
              `;

        return rows as unknown as Array<{
            id: number;
            source_list_wikilink: string;
            album_name: string;
            album_wikilink: string;
            wikipedia_page_id: number | null;
            release_year: number | null;
            release_month: string;
            release_day: number | null;
            artist_name: string | null;
        }>;
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
