import {db} from "app/repositories/db";
import {parseDateCompletenessMode} from "app/yearlyalbums/query/missingmode";
import {buildYearlyAlbumSourcePages} from "app/yearlyalbums/sourcepages";

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

    const sourceListWikilinks = buildYearlyAlbumSourcePages(year);
    const rows: MissingAlbumRow[] = await db`
        -- Normalize each reference once, then build independent hash lookups.
        -- Keep subqueries uncorrelated and filter null keys so NOT IN stays null-safe.
        with source_references as materialized (
            select
                yar.wikipedia_page_id,
                yar.needs_review,
                lower(replace(replace(replace(replace(replace(replace(yar.album_wikilink, '%27', ''''), '%28', '('), '%29', ')'), '%2C', ','), '%26', '&'), '%21', '!')) as decoded_wikilink,
                regexp_replace(lower(yar.album_wikilink), '_\\(album\\)$', '') as album_link,
                lower(regexp_replace(coalesce(yar.album_name, ''), '\\s+\\(album\\)$', '')) as album_title,
                lower(coalesce(yar.album_name, '')) as review_title
            from yearly_album_references yar
            where yar.source_list_wikilink = any(${sourceListWikilinks}::text[])
        )
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
          and lower(coalesce(r.releasetype, '')) not in ('greatest', 'compilation', 'soundtrack', 'film', 'cast', 'box')
          and lower(coalesce(r.releasetype, '')) not like '%box set%'
          and lower(coalesce(r.releasetype, '')) not like '%boxset%'
          and lower(coalesce(r.title, '')) not like '%compilation%'
          and lower(coalesce(r.original_title, '')) not like '%compilation%'
          and lower(coalesce(r.original_releasetype, '')) not like '%soundtrack%'
          and lower(coalesce(r.original_releasetype, '')) not like '%film%'
          and lower(coalesce(r.original_releasetype, '')) not like '%box set%'
          and lower(coalesce(r.original_releasetype, '')) not like '%boxset%'
          and lower(coalesce(r.original_releasetype, '')) <> 'box'
          and lower(coalesce(r.original_categories_text, '')) not like '%compilation albums%'
          and lower(coalesce(r.original_categories_text, '')) not like '%reissue albums%'
          and (r.wikipedia_page_id is null or r.wikipedia_page_id not in (
            select wikipedia_page_id from source_references where wikipedia_page_id is not null
          ))
          and (r.wikipedia_page_id is not null or r.wikilink is null or lower(replace(replace(replace(replace(replace(replace(r.wikilink, '%27', ''''), '%28', '('), '%29', ')'), '%2C', ','), '%26', '&'), '%21', '!')) not in (
            select decoded_wikilink from source_references where decoded_wikilink is not null
          ))
          and (r.wikilink is null or regexp_replace(lower(r.wikilink), '_\\(album\\)$', '') not in (
            select album_link from source_references where album_link is not null
          ))
          and lower(regexp_replace(coalesce(r.original_title, ''), '\\s+\\(album\\)$', '')) not in (
            select album_title from source_references
          )
          and lower(regexp_replace(coalesce(r.title, ''), '\\s+\\(album\\)$', '')) not in (
            select album_title from source_references
          )
          -- Review flags also suppress URL matches when the release has a page ID.
          -- Their page-ID matches are already covered by the first lookup.
          and (r.wikilink is null or lower(replace(replace(replace(replace(replace(replace(r.wikilink, '%27', ''''), '%28', '('), '%29', ')'), '%2C', ','), '%26', '&'), '%21', '!')) not in (
            select decoded_wikilink from source_references
            where needs_review = true and decoded_wikilink is not null
          ))
          and lower(coalesce(r.original_title, '')) not in (
            select review_title from source_references where needs_review = true
          )
          and lower(coalesce(r.title, '')) not in (
            select review_title from source_references where needs_review = true
          )
        order by coalesce(r.manual_number_of_reviews, r.number_of_reviews) asc, r.artist_name asc, r.title asc
    `;

    console.log(`[yearly.albums.missing] year=${year} mode=${mode} source=${sourceListWikilinks.join(",")} missing_count=${rows.length}`);

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
