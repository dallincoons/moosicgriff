import {db} from "app/repositories/db";
import {syncYearlyAlbumReferences} from "app/yearlyalbums/sync";
import {DateCompletenessMode, parseDateCompletenessMode} from "app/yearlyalbums/query/missingmode";
import {getPrimaryYearlyAlbumSourceWikilink} from "app/yearlyalbums/sourcepages";

type MissingAlbumRow = {
    artist_name: string;
    title: string;
    original_title: string | null;
    wikilink: string;
    wikipedia_page_id: number | null;
    number_of_reviews: number;
};

export async function yearlyAlbumsMissingFromReference(yearArg?: string, modeArg?: string, freshArg?: string): Promise<void> {
    const year = parseInt(yearArg || "", 10);
    if (Number.isNaN(year) || year < 1900 || year > 2100) {
        console.log(`[yearly.albums.missing] invalid year "${yearArg}". example: yearly.albums.missing 2005 full`);
        return;
    }
    const mode = parseDateCompletenessMode(modeArg);
    if (!mode) {
        console.log(`[yearly.albums.missing] invalid mode "${modeArg}". expected: full`);
        return;
    }

    const freshMode = parseFreshMode(freshArg);
    if (freshArg && !freshMode) {
        console.log(`[yearly.albums.missing] invalid fresh flag "${freshArg}". expected: fresh`);
        return;
    }

    console.log(
        `[yearly.albums.missing] syncing ${year} before missing query...${freshMode ? " (fresh)" : ""}`,
    );
    await syncYearlyAlbumReferences(String(year), freshMode ? "fresh" : undefined);

    const sourceListWikilink = getPrimaryYearlyAlbumSourceWikilink(year);
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
            (${mode}::text = 'all')
            or (${mode}::text = 'full' and r.dateyear is not null and coalesce(trim(r.datemonth), '') <> '' and r.dateday is not null)
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
          and not exists (
            select 1
            from yearly_album_references yar_review
            where yar_review.source_list_wikilink = ${sourceListWikilink}
              and yar_review.needs_review = true
              and (
                (r.wikipedia_page_id is not null and yar_review.wikipedia_page_id = r.wikipedia_page_id)
                or lower(
                    replace(
                        replace(
                            replace(
                                replace(
                                    replace(
                                        replace(yar_review.album_wikilink, '%27', ''''),
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
                or lower(coalesce(yar_review.album_name, '')) = lower(coalesce(r.original_title, ''))
                or lower(coalesce(yar_review.album_name, '')) = lower(coalesce(r.title, ''))
              )
          )
        order by r.number_of_reviews asc, r.artist_name asc, r.title asc
    `;

    console.log(`[yearly.albums.missing] year=${year} mode=${mode} source=${sourceListWikilink} missing_count=${rows.length}`);

    for (const row of rows) {
        const title = row.original_title || row.title;
        console.log(`Album: ${title}`);
        console.log(`Artist: ${row.artist_name}`);
        console.log(`Reviews: ${row.number_of_reviews}`);
        console.log("");
    }

    console.log(`Total albums: ${rows.length}`);
}

function parseFreshMode(value?: string): boolean {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "fresh" || normalized === "--fresh";
}
