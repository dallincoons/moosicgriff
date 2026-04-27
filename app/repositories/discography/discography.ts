import {db} from 'app/repositories/db';
import {DBRelease, Release} from "../../discography/release";
import {DBArtist} from "../../artists/artist";
import {RELEASE_REVIEWS_PARSE_VERSION} from "../../discography/reviewsparseversion";

const green = "\x1b[32m";
const reset = "\x1b[0m";

class Discography {
    async getReleaseByWikilink(releaseWikilink: string): Promise<DBRelease | undefined> {
        const [release]: [DBRelease?] = await db`
            SELECT *
            FROM releases
            WHERE lower(wikilink) = lower(${releaseWikilink})
            LIMIT 1
        `;

        return release;
    }

    async getReleaseByArtistAndLink(artistWikilink: string, releaseWikilink: string): Promise<DBRelease | undefined> {
        const [release]: [DBRelease?] = await db`
            SELECT *
            FROM releases
            WHERE artist_wikilink = ${artistWikilink}
            AND wikilink = ${releaseWikilink}
            LIMIT 1
        `;

        return release;
    }

    async getReleaseByWikipediaPageId(wikipediaPageId: number): Promise<DBRelease | undefined> {
        const [release]: [DBRelease?] = await db`
            SELECT *
            FROM releases
            WHERE wikipedia_page_id = ${wikipediaPageId}
            LIMIT 1
        `;

        return release;
    }

    async upsertRelease(release: Release, artist: DBArtist, contentHash: string) {
        if (!release.year) {
            console.error(`missing release year: ${artist.artistname}, ${release.name}`);
            return;
        }

        const originalReleaseType = release.type || "";
        const normalizedReleaseType = normalizeReleaseType(originalReleaseType);
        const existingByLink = await this.getReleaseByArtistAndLink(artist.wikilink, release.wikilink);
        const existingByWikilink = await this.getReleaseByWikilink(release.wikilink);
        const existingByPageId = release.wikipedia_page_id
            ? await this.getReleaseByWikipediaPageId(release.wikipedia_page_id)
            : undefined;
        const existing = existingByPageId || existingByWikilink || existingByLink;

        if (!existing) {
            await db`
                insert into releases
                    (
                        artist_id,
                        wikilink,
                        wikipedia_page_id,
                        artist_wikilink,
                        artist_name,
                        artist_display_name,
                        title,
                        original_title,
                        releasetype,
                        original_releasetype,
                        label,
                        original_labels_text,
                        labels_last_scraped_at,
                        original_categories_text,
                        categories_last_scraped_at,
                        genre,
                        original_genre,
                        recorded,
                        studio,
                        producer,
                        producer_last_scraped_at,
                        dateday,
                        datemonth,
                        dateyear,
                        content_hash,
                        number_of_reviews,
                        review_links,
                        reviews_parse_version
                    ) VALUES (
                        ${artist.id}::integer,
                        ${release.wikilink}::text,
                        ${release.wikipedia_page_id ?? null}::bigint,
                        ${artist.wikilink}::text,
                        ${(release.artist_name || artist.artistname)}::text,
                        ${(release.artist_display_name || release.artist_name || artist.artistname)}::text,
                        ${release.name}::text,
                        ${(release.original_title || release.name)}::text,
                        ${normalizedReleaseType}::text,
                        ${originalReleaseType}::text,
                        ${release.label}::text,
                        ${release.original_labels_text}::text,
                        CURRENT_TIMESTAMP,
                        ${release.original_categories_text}::text,
                        CURRENT_TIMESTAMP,
                        ${release.genre}::text,
                        ${release.original_genre}::text,
                        ${release.recorded}::text,
                        ${release.studio}::text,
                        ${release.producer}::text,
                        CURRENT_TIMESTAMP,
                        ${release.day}::integer,
                        ${release.month}::text,
                        ${release.year}::integer,
                        ${contentHash}::text,
                        ${release.number_of_reviews}::integer,
                        ${release.review_links}::text,
                        ${RELEASE_REVIEWS_PARSE_VERSION}::integer
                    )
            `;
            console.log(`${green}[discography] inserted album: ${release.name} (${release.wikilink})${reset}`);
            return;
        }

        await db`
            update releases
            set
                artist_id = ${artist.id}::integer,
                wikilink = ${release.wikilink}::text,
                wikipedia_page_id = ${release.wikipedia_page_id ?? null}::bigint,
                artist_name = ${(release.artist_name || artist.artistname)}::text,
                artist_display_name = ${(release.artist_display_name || release.artist_name || artist.artistname)}::text,
                title = ${release.name}::text,
                original_title = ${(release.original_title || release.name)}::text,
                releasetype = ${normalizedReleaseType}::text,
                original_releasetype = ${originalReleaseType}::text,
                label = ${release.label}::text,
                original_labels_text = ${release.original_labels_text}::text,
                labels_last_scraped_at = CURRENT_TIMESTAMP,
                original_categories_text = ${release.original_categories_text}::text,
                categories_last_scraped_at = CURRENT_TIMESTAMP,
                genre = ${release.genre}::text,
                original_genre = ${release.original_genre}::text,
                recorded = ${release.recorded}::text,
                studio = ${release.studio}::text,
                producer = ${release.producer}::text,
                producer_last_scraped_at = CURRENT_TIMESTAMP,
                dateday = ${release.day}::integer,
                datemonth = ${release.month}::text,
                dateyear = ${release.year}::integer,
                content_hash = ${contentHash}::text,
                number_of_reviews = ${release.number_of_reviews}::integer,
                review_links = ${release.review_links}::text,
                reviews_parse_version = ${RELEASE_REVIEWS_PARSE_VERSION}::integer,
                last_updated_at = CURRENT_TIMESTAMP
            where id = ${existing.id}
        `;
    }

    async upsertReleaseWithoutArtist(release: Release, contentHash: string): Promise<void> {
        if (!release.year) {
            return;
        }

        const fallbackArtistWikilink = buildFallbackArtistWikilink(release);
        const fallbackArtistName = (release.artist_name || release.artist_display_name || "").trim();
        const originalReleaseType = release.type || "";
        const normalizedReleaseType = normalizeReleaseType(originalReleaseType);
        const existingByLink = await this.getReleaseByArtistAndLink(fallbackArtistWikilink, release.wikilink);
        const existingByWikilink = await this.getReleaseByWikilink(release.wikilink);
        const existingByPageId = release.wikipedia_page_id
            ? await this.getReleaseByWikipediaPageId(release.wikipedia_page_id)
            : undefined;
        const existing = existingByPageId || existingByWikilink || existingByLink;

        if (!existing) {
            await db`
                insert into releases
                    (
                        artist_id,
                        wikilink,
                        wikipedia_page_id,
                        artist_wikilink,
                        artist_name,
                        artist_display_name,
                        title,
                        original_title,
                        releasetype,
                        original_releasetype,
                        label,
                        original_labels_text,
                        labels_last_scraped_at,
                        original_categories_text,
                        categories_last_scraped_at,
                        genre,
                        original_genre,
                        recorded,
                        studio,
                        producer,
                        producer_last_scraped_at,
                        dateday,
                        datemonth,
                        dateyear,
                        content_hash,
                        number_of_reviews,
                        review_links,
                        reviews_parse_version
                    ) VALUES (
                        null,
                        ${release.wikilink}::text,
                        ${release.wikipedia_page_id ?? null}::bigint,
                        ${fallbackArtistWikilink}::text,
                        ${fallbackArtistName}::text,
                        ${(release.artist_display_name || fallbackArtistName)}::text,
                        ${release.name}::text,
                        ${(release.original_title || release.name)}::text,
                        ${normalizedReleaseType}::text,
                        ${originalReleaseType}::text,
                        ${release.label}::text,
                        ${release.original_labels_text}::text,
                        CURRENT_TIMESTAMP,
                        ${release.original_categories_text}::text,
                        CURRENT_TIMESTAMP,
                        ${release.genre}::text,
                        ${release.original_genre}::text,
                        ${release.recorded}::text,
                        ${release.studio}::text,
                        ${release.producer}::text,
                        CURRENT_TIMESTAMP,
                        ${release.day}::integer,
                        ${release.month}::text,
                        ${release.year}::integer,
                        ${contentHash}::text,
                        ${release.number_of_reviews}::integer,
                        ${release.review_links}::text,
                        ${RELEASE_REVIEWS_PARSE_VERSION}::integer
                    )
            `;
            return;
        }

        await db`
            update releases
            set
                wikilink = ${release.wikilink}::text,
                wikipedia_page_id = ${release.wikipedia_page_id ?? null}::bigint,
                artist_wikilink = ${fallbackArtistWikilink}::text,
                artist_name = ${fallbackArtistName}::text,
                artist_display_name = ${(release.artist_display_name || fallbackArtistName)}::text,
                title = ${release.name}::text,
                original_title = ${(release.original_title || release.name)}::text,
                releasetype = ${normalizedReleaseType}::text,
                original_releasetype = ${originalReleaseType}::text,
                label = ${release.label}::text,
                original_labels_text = ${release.original_labels_text}::text,
                labels_last_scraped_at = CURRENT_TIMESTAMP,
                original_categories_text = ${release.original_categories_text}::text,
                categories_last_scraped_at = CURRENT_TIMESTAMP,
                genre = ${release.genre}::text,
                original_genre = ${release.original_genre}::text,
                recorded = ${release.recorded}::text,
                studio = ${release.studio}::text,
                producer = ${release.producer}::text,
                producer_last_scraped_at = CURRENT_TIMESTAMP,
                dateday = ${release.day}::integer,
                datemonth = ${release.month}::text,
                dateyear = ${release.year}::integer,
                content_hash = ${contentHash}::text,
                number_of_reviews = ${release.number_of_reviews}::integer,
                review_links = ${release.review_links}::text,
                reviews_parse_version = ${RELEASE_REVIEWS_PARSE_VERSION}::integer,
                last_updated_at = CURRENT_TIMESTAMP
            where id = ${existing.id}
        `;
    }

    async backfillArtistIds(): Promise<number> {
        const updated = await db`
            update releases r
            set artist_id = a.id
            from artists a
            where r.artist_id is null
              and lower(r.artist_wikilink) = lower(a.wikilink)
            returning r.id
        `;

        return updated.length;
    }

    async getReleasesPendingLabelBackfill(limit?: number, retryBlanks: boolean = false): Promise<DBRelease[]> {
        const rows: DBRelease[] = retryBlanks
            ? limit && limit > 0
                ? await db`
                    select *
                    from releases
                    where wikilink is not null
                      and length(trim(wikilink)) > 0
                      and (
                        labels_last_scraped_at is null
                        or (
                            labels_last_scraped_at is not null
                            and length(trim(coalesce(label, ''))) = 0
                            and length(trim(coalesce(original_labels_text, ''))) = 0
                        )
                      )
                    order by
                        case when labels_last_scraped_at is null then 0 else 1 end asc,
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                    limit ${limit}
                `
                : await db`
                    select *
                    from releases
                    where wikilink is not null
                      and length(trim(wikilink)) > 0
                      and (
                        labels_last_scraped_at is null
                        or (
                            labels_last_scraped_at is not null
                            and length(trim(coalesce(label, ''))) = 0
                            and length(trim(coalesce(original_labels_text, ''))) = 0
                        )
                      )
                    order by
                        case when labels_last_scraped_at is null then 0 else 1 end asc,
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                `
            : limit && limit > 0
            ? await db`
                select *
                from releases
                where labels_last_scraped_at is null
                  and wikilink is not null
                  and length(trim(wikilink)) > 0
                order by
                    case when length(trim(coalesce(label, ''))) = 0 then 0 else 1 end asc,
                    dateyear asc nulls first,
                    artist_name asc,
                    title asc
                limit ${limit}
            `
            : await db`
                select *
                from releases
                where labels_last_scraped_at is null
                  and wikilink is not null
                  and length(trim(wikilink)) > 0
                order by
                    case when length(trim(coalesce(label, ''))) = 0 then 0 else 1 end asc,
                    dateyear asc nulls first,
                    artist_name asc,
                    title asc
            `;

        return rows;
    }

    async saveReleaseLabelsById(id: number, label: string, originalLabelsText: string): Promise<void> {
        await db`
            update releases
            set
                label = ${label}::text,
                original_labels_text = ${originalLabelsText}::text,
                labels_last_scraped_at = CURRENT_TIMESTAMP,
                last_updated_at = CURRENT_TIMESTAMP
            where id = ${id}
        `;
    }

    async getReleasesPendingCategoryBackfill(limit?: number, retryBlanks: boolean = false): Promise<DBRelease[]> {
        const rows: DBRelease[] = retryBlanks
            ? limit && limit > 0
                ? await db`
                    select *
                    from releases
                    where wikilink is not null
                      and length(trim(wikilink)) > 0
                      and (
                        categories_last_scraped_at is null
                        or (
                            categories_last_scraped_at is not null
                            and length(trim(coalesce(original_categories_text, ''))) = 0
                        )
                      )
                    order by
                        case when categories_last_scraped_at is null then 0 else 1 end asc,
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                    limit ${limit}
                `
                : await db`
                    select *
                    from releases
                    where wikilink is not null
                      and length(trim(wikilink)) > 0
                      and (
                        categories_last_scraped_at is null
                        or (
                            categories_last_scraped_at is not null
                            and length(trim(coalesce(original_categories_text, ''))) = 0
                        )
                      )
                    order by
                        case when categories_last_scraped_at is null then 0 else 1 end asc,
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                `
            : limit && limit > 0
                ? await db`
                    select *
                    from releases
                    where categories_last_scraped_at is null
                      and wikilink is not null
                      and length(trim(wikilink)) > 0
                    order by
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                    limit ${limit}
                `
                : await db`
                    select *
                    from releases
                    where categories_last_scraped_at is null
                      and wikilink is not null
                      and length(trim(wikilink)) > 0
                    order by
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                `;

        return rows;
    }

    async saveReleaseCategoriesById(id: number, originalCategoriesText: string): Promise<void> {
        await db`
            update releases
            set
                original_categories_text = ${originalCategoriesText}::text,
                categories_last_scraped_at = CURRENT_TIMESTAMP,
                last_updated_at = CURRENT_TIMESTAMP
            where id = ${id}
        `;
    }

    async getReleasesPendingProducerBackfill(limit?: number, retryBlanks: boolean = false): Promise<DBRelease[]> {
        const rows: DBRelease[] = retryBlanks
            ? limit && limit > 0
                ? await db`
                    select *
                    from releases
                    where wikilink is not null
                      and length(trim(wikilink)) > 0
                      and (
                        producer_last_scraped_at is null
                        or (
                            producer_last_scraped_at is not null
                            and length(trim(coalesce(producer, ''))) = 0
                        )
                      )
                    order by
                        case when producer_last_scraped_at is null then 0 else 1 end asc,
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                    limit ${limit}
                `
                : await db`
                    select *
                    from releases
                    where wikilink is not null
                      and length(trim(wikilink)) > 0
                      and (
                        producer_last_scraped_at is null
                        or (
                            producer_last_scraped_at is not null
                            and length(trim(coalesce(producer, ''))) = 0
                        )
                      )
                    order by
                        case when producer_last_scraped_at is null then 0 else 1 end asc,
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                `
            : limit && limit > 0
                ? await db`
                    select *
                    from releases
                    where producer_last_scraped_at is null
                      and wikilink is not null
                      and length(trim(wikilink)) > 0
                    order by
                        case when length(trim(coalesce(producer, ''))) = 0 then 0 else 1 end asc,
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                    limit ${limit}
                `
                : await db`
                    select *
                    from releases
                    where producer_last_scraped_at is null
                      and wikilink is not null
                      and length(trim(wikilink)) > 0
                    order by
                        case when length(trim(coalesce(producer, ''))) = 0 then 0 else 1 end asc,
                        dateyear asc nulls first,
                        artist_name asc,
                        title asc
                `;

        return rows;
    }

    async saveReleaseProducerById(id: number, producer: string): Promise<void> {
        await db`
            update releases
            set
                producer = ${producer}::text,
                producer_last_scraped_at = CURRENT_TIMESTAMP,
                last_updated_at = CURRENT_TIMESTAMP
            where id = ${id}
        `;
    }

    async getReleasesLikelyOnLabel(labelName: string): Promise<DBRelease[]> {
        const normalized = (labelName || "").trim();
        if (!normalized) {
            return [];
        }

        return await db`
            select *
            from releases
            where (
                lower(coalesce(label, '')) like lower(${`%${normalized}%`})
                or lower(coalesce(original_labels_text, '')) like lower(${`%${normalized}%`})
            )
              and wikilink is not null
              and length(trim(wikilink)) > 0
            order by
                dateyear asc nulls first,
                artist_name asc,
                title asc
        `;
    }

    async getReleasesLikelyByProducer(producerName: string): Promise<DBRelease[]> {
        const normalized = (producerName || "").trim();
        if (!normalized) {
            return [];
        }

        return await db`
            select *
            from releases
            where lower(coalesce(producer, '')) like lower(${`%${normalized}%`})
              and wikilink is not null
              and length(trim(wikilink)) > 0
            order by
                dateyear asc nulls first,
                artist_name asc,
                title asc
        `;
    }

    async getUniqueLinkedLabels(): Promise<string[]> {
        const rows: Array<{ original_labels_text: string | null }> = await db`
            select original_labels_text
            from releases
            where wikilink is not null
              and length(trim(wikilink)) > 0
              and original_labels_text is not null
              and position('[[' in original_labels_text) > 0
        `;

        const labels = new Set<string>();
        const wikilinkRegex = /\[\[([^|\]]+)(?:\|[^\]]+)?]]/g;

        for (const row of rows) {
            const raw = row.original_labels_text || "";
            let match: RegExpExecArray | null;
            while ((match = wikilinkRegex.exec(raw)) !== null) {
                const label = (match[1] || "")
                    .split("#")[0]
                    .replace(/_/g, " ")
                    .trim();
                if (label.length > 0) {
                    labels.add(label);
                }
            }
        }

        return [...labels].sort((a, b) => a.localeCompare(b));
    }

    async clearReleaseLink(releaseWikilink: string): Promise<number> {
        const rows = await db`
            update releases
            set
                wikilink = null,
                wikipedia_page_id = null,
                content_hash = null,
                last_updated_at = CURRENT_TIMESTAMP
            where wikilink = ${releaseWikilink}::text
        `;

        return rows.count || 0;
    }

    async setManualReviewCount(releaseWikilink: string, manualReviewCount: number | null): Promise<number> {
        const updated = await db`
            update releases
            set
                manual_number_of_reviews = ${manualReviewCount}::integer,
                last_updated_at = CURRENT_TIMESTAMP
            where lower(wikilink) = lower(${releaseWikilink})
            returning id
        `;

        return updated.length;
    }
}

export default new Discography();

function buildFallbackArtistWikilink(release: Release): string {
    const direct = (release.artist_wikilink || "").trim();
    if (direct) {
        return direct;
    }

    const name = (release.artist_name || release.artist_display_name || "").trim();
    if (name) {
        return `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/\s+/g, "_"))}`;
    }

    const fallback = (release.original_title || release.name || "unknown_artist").trim();
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(fallback.replace(/\s+/g, "_"))}`;
}

function normalizeReleaseType(rawType: string): string {
    let normalized = (rawType || "").trim().toLowerCase();

    if (!normalized) {
        return "studio";
    }
    if (normalized === "single album") {
        return "single album";
    }
    if (normalized === "album") {
        return "studio";
    }
    if (normalized.endsWith(" album")) {
        normalized = normalized.replace(/\s+album$/, "").trim();
        if (!normalized) {
            normalized = "studio";
        }
    }
    if (normalized.includes("soundtrack")) {
        return "soundtrack";
    }
    if (normalized.includes("film")) {
        return "film";
    }
    if (normalized.includes("cast")) {
        return "cast";
    }
    if (normalized.includes("mixtape")) {
        return "mixtape";
    }
    if (normalized.includes("compilation")) {
        return "compilation";
    }
    if (normalized.includes("greatest")) {
        return "greatest";
    }
    if (normalized.includes("box")) {
        return "box";
    }
    if (normalized.includes("remix")) {
        return "remix";
    }
    if (normalized.includes("demo")) {
        return "demo";
    }
    if (normalized.includes("video")) {
        return "video";
    }
    if (normalized.includes("live")) {
        return "live";
    }
    if (normalized.includes("studio album") || normalized.includes("studio")) {
        return "studio";
    }
    if (normalized.includes("ep") || normalized.includes("extended play")) {
        return "EP";
    }

    return "studio";
}
