import {db} from "app/repositories/db";
import {DateCompletenessMode, parseDateCompletenessMode} from "app/yearlyalbums/query/missingmode";
import {getPrimaryYearlyAlbumSourceWikilink} from "app/yearlyalbums/sourcepages";

type MissingAlbumRow = {
    artist_name: string;
    title: string;
    original_title: string | null;
    wikilink: string;
    wikipedia_page_id: number | null;
    effective_number_of_reviews: number;
};

export async function yearlyAlbumsMissingFromReference(
    yearArg?: string,
    modeArg?: string,
    optionArg1?: string,
    optionArg2?: string,
): Promise<void> {
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

    const options = parseModeOptions([optionArg1, optionArg2]);
    if (options.error) {
        console.log(options.error);
        return;
    }

    if (!options.skipSync) {
        const {syncYearlyAlbumReferences} = await import("app/yearlyalbums/sync");
        console.log(
            `[yearly.albums.missing] syncing ${year} before missing query...${options.freshMode ? " (fresh)" : ""}`,
        );
        await syncYearlyAlbumReferences(String(year), options.freshMode ? "fresh" : undefined);
    } else {
        console.log(`[yearly.albums.missing] skip sync enabled; querying database state only for ${year}`);
    }

    const sourceListWikilink = getPrimaryYearlyAlbumSourceWikilink(year);
    const rows: MissingAlbumRow[] = await db`
        select
            r.artist_name,
            r.title,
            r.original_title,
            r.wikilink,
            r.wikipedia_page_id,
            coalesce(r.manual_number_of_reviews, r.number_of_reviews) as effective_number_of_reviews
        from releases r
        where r.dateyear = ${year}
          and (
            (${mode}::text = 'all')
            or (${mode}::text = 'full' and r.dateyear is not null and coalesce(trim(r.datemonth), '') <> '' and r.dateday is not null)
          )
          and coalesce(r.manual_number_of_reviews, r.number_of_reviews) >= 3
          and coalesce(r.releasetype, '') not in ('greatest', 'compilation', 'soundtrack', 'film', 'cast')
          and lower(coalesce(r.releasetype, '')) not like '%box set%'
          and lower(coalesce(r.releasetype, '')) not like '%boxset%'
          and lower(coalesce(r.title, '')) not like '%compilation%'
          and lower(coalesce(r.original_title, '')) not like '%compilation%'
          and lower(coalesce(r.original_releasetype, '')) not like '%soundtrack%'
          and lower(coalesce(r.original_releasetype, '')) not like '%film%'
          and lower(coalesce(r.original_releasetype, '')) not like '%box set%'
          and lower(coalesce(r.original_releasetype, '')) not like '%boxset%'
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
        order by coalesce(r.manual_number_of_reviews, r.number_of_reviews) asc, r.artist_name asc, r.title asc
    `;

    console.log(`[yearly.albums.missing] year=${year} mode=${mode} source=${sourceListWikilink} missing_count=${rows.length}`);

    for (const row of rows) {
        const title = row.original_title || row.title;
        console.log(`Album: ${title}`);
        console.log(`Artist: ${row.artist_name}`);
        console.log(`Reviews: ${row.effective_number_of_reviews}`);
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

function parseNoSyncMode(value?: string): boolean {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "no-sync" || normalized === "--no-sync";
}

function parseModeOptions(values: Array<string | undefined>): { freshMode: boolean; skipSync: boolean; error: string | null } {
    let freshMode = false;
    let skipSync = false;

    for (const value of values) {
        if (!value) {
            continue;
        }
        if (parseFreshMode(value)) {
            freshMode = true;
            continue;
        }
        if (parseNoSyncMode(value)) {
            skipSync = true;
            continue;
        }
        return {
            freshMode: false,
            skipSync: false,
            error: `[yearly.albums.missing] invalid option "${value}". expected: fresh or no-sync`,
        };
    }

    if (freshMode && skipSync) {
        return {
            freshMode: false,
            skipSync: false,
            error: `[yearly.albums.missing] invalid options. "fresh" and "no-sync" cannot be used together.`,
        };
    }

    return {freshMode, skipSync, error: null};
}
