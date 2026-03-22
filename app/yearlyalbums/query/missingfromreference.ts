import {db} from "app/repositories/db";
import {syncYearlyAlbumReferences} from "app/yearlyalbums/sync";

type MissingAlbumRow = {
    artist_name: string;
    title: string;
    original_title: string | null;
    wikilink: string;
    wikipedia_page_id: number | null;
    number_of_reviews: number;
};

type DateCompletenessMode = "full" | "incomplete";

export async function yearlyAlbumsMissingFromReference(yearArg?: string, modeArg?: string): Promise<void> {
    const year = parseInt(yearArg || "", 10);
    if (Number.isNaN(year) || year < 1900 || year > 2100) {
        console.log(`[yearly.albums.missing] invalid year "${yearArg}". example: yearly.albums.missing 2005 full`);
        return;
    }
    const mode = parseDateCompletenessMode(modeArg);
    if (!mode) {
        console.log(`[yearly.albums.missing] invalid mode "${modeArg}". expected: full or incomplete`);
        return;
    }

    console.log(`[yearly.albums.missing] syncing ${year} before missing query...`);
    await syncYearlyAlbumReferences(String(year));

    const sourceListWikilink = `https://en.wikipedia.org/wiki/List_of_${year}_albums`;
    const rows: MissingAlbumRow[] = await db`
        select
            r.artist_name,
            r.title,
            r.original_title,
            r.wikilink,
            r.wikipedia_page_id,
            r.number_of_reviews
        from releases r
        where r.dateyear = ${year}
          and (
            (${mode}::text = 'full' and r.dateyear is not null and coalesce(trim(r.datemonth), '') <> '' and r.dateday is not null)
            or (${mode}::text = 'incomplete' and (r.dateyear is null or coalesce(trim(r.datemonth), '') = '' or r.dateday is null))
          )
          and r.number_of_reviews >= 3
          and coalesce(r.releasetype, '') not in ('greatest', 'compilation', 'soundtrack', 'film', 'cast')
          and lower(coalesce(r.title, '')) not like '%compilation%'
          and lower(coalesce(r.original_title, '')) not like '%compilation%'
          and lower(coalesce(r.original_releasetype, '')) not like '%soundtrack%'
          and lower(coalesce(r.original_releasetype, '')) not like '%film%'
          and not exists (
            select 1
            from yearly_album_references yar
            where yar.source_list_wikilink = ${sourceListWikilink}
              and (
                (r.wikipedia_page_id is not null and yar.wikipedia_page_id = r.wikipedia_page_id)
                or (
                    r.wikipedia_page_id is null
                    and lower(
                        replace(
                            replace(
                                replace(
                                    replace(
                                        replace(
                                            replace(yar.album_wikilink, '%27', ''''),
                                            '%28',
                                            '('
                                        ),
                                        '%29',
                                        ')'
                                    ),
                                    '%2C',
                                    ','
                                ),
                                '%26',
                                '&'
                            ),
                            '%21',
                            '!'
                        )
                    ) = lower(
                        replace(
                            replace(
                                replace(
                                    replace(
                                        replace(
                                            replace(r.wikilink, '%27', ''''),
                                            '%28',
                                            '('
                                        ),
                                        '%29',
                                        ')'
                                    ),
                                    '%2C',
                                    ','
                                ),
                                '%26',
                                '&'
                            ),
                            '%21',
                            '!'
                        )
                    )
                )
              )
          )
        order by r.artist_name asc, r.title asc
    `;

    console.log(`[yearly.albums.missing] year=${year} mode=${mode} source=${sourceListWikilink} missing_count=${rows.length}`);

    for (const row of rows) {
        const title = row.original_title || row.title;
        console.log(`Album: ${title}`);
        console.log(`Artist: ${row.artist_name}`);
        console.log("");
    }

    console.log(`Total albums: ${rows.length}`);
}

function parseDateCompletenessMode(modeArg?: string): DateCompletenessMode | null {
    if (!modeArg) {
        return "incomplete";
    }
    const normalized = modeArg.trim().toLowerCase();
    if (normalized === "full" || normalized === "incomplete") {
        return normalized;
    }
    return null;
}
