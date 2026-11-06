import {createHash} from "crypto";
import {getHtml} from "app/clients/wikipedia";
import {db} from "app/repositories/db";
import discography from "app/repositories/discography/discography";
import {getAlbumReleaseFromApi} from "app/clients/wikipediaapi";
import artists from "app/repositories/artists/artists";
import {handleLink as handleArtistLink} from "app/artists/scrape";
import {Release} from "app/discography/release";
import {DBArtist} from "app/artists/artist";

type ReleaseHashRow = {
    id: number;
    artist_id: number | null;
    artist_name: string;
    artist_display_name: string | null;
    artist_wikilink: string | null;
    title: string;
    original_title: string | null;
    releasetype: string;
    original_releasetype: string | null;
    label: string;
    original_labels_text: string | null;
    original_categories_text: string | null;
    genre: string | null;
    original_genre: string | null;
    recorded: string | null;
    studio: string | null;
    producer: string;
    dateday: number | null;
    datemonth: string;
    dateyear: number | null;
    wikilink: string | null;
    wikipedia_page_id: number | null;
    number_of_reviews: number;
    review_links: string | null;
    content_hash: string | null;
    scrape_version: number;
};

type VersionStatsRow = {
    total_rows: number;
    min_version: number | null;
    max_version: number | null;
};

const green = "\x1b[32m";
const reset = "\x1b[0m";

export async function releasesRescrape(limitArg?: string): Promise<void> {
    const limit = parseLimit(limitArg);
    if (limitArg && limit === null) {
        console.log(`[releases.rescrape] invalid limit "${limitArg}"`);
        console.log(`[releases.rescrape] example: releases.rescrape 200`);
        return;
    }

    const [stats]: VersionStatsRow[] = await db`
        select
            count(*)::integer as total_rows,
            min(scrape_version)::integer as min_version,
            max(scrape_version)::integer as max_version
        from releases
    `;

    const totalRows = stats?.total_rows || 0;
    if (totalRows === 0) {
        console.log("[releases.rescrape] no release rows to process");
        return;
    }

    const minVersion = stats?.min_version ?? 0;
    const maxVersion = stats?.max_version ?? 0;
    const targetVersion = minVersion === maxVersion ? maxVersion + 1 : maxVersion;

    const rows: ReleaseHashRow[] = limit
        ? await db`
            select
                id,
                artist_id,
                artist_name,
                artist_display_name,
                artist_wikilink,
                title,
                original_title,
                releasetype,
                original_releasetype,
                label,
                original_labels_text,
                original_categories_text,
                genre,
                original_genre,
                recorded,
                studio,
                producer,
                dateday,
                datemonth,
                dateyear,
                wikilink,
                wikipedia_page_id,
                number_of_reviews,
                review_links,
                content_hash,
                scrape_version
            from releases
            where scrape_version < ${targetVersion}
            order by scrape_version asc, id asc
            limit ${limit}
        `
        : await db`
            select
                id,
                artist_id,
                artist_name,
                artist_display_name,
                artist_wikilink,
                title,
                original_title,
                releasetype,
                original_releasetype,
                label,
                original_labels_text,
                original_categories_text,
                genre,
                original_genre,
                recorded,
                studio,
                producer,
                dateday,
                datemonth,
                dateyear,
                wikilink,
                wikipedia_page_id,
                number_of_reviews,
                review_links,
                content_hash,
                scrape_version
            from releases
            where scrape_version < ${targetVersion}
            order by scrape_version asc, id asc
        `;

    console.log(
        `[releases.rescrape] total_rows=${totalRows} min_version=${minVersion} max_version=${maxVersion} target_version=${targetVersion} candidates=${rows.length}${limit ? ` limit=${limit}` : ""}`,
    );

    if (rows.length === 0) {
        console.log("[releases.rescrape] no rows below target version");
        return;
    }

    let promotedNoLink = 0;
    let rescraped = 0;
    let upserted = 0;
    let hashOnlyUpdated = 0;
    let unchangedHashPromoted = 0;
    let skippedNotAlbumOrMissing = 0;
    let failed = 0;

    for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const prefix = `[releases.rescrape] ${index + 1}/${rows.length} id=${row.id}`;
        const releaseName = `${row.artist_name} - ${row.original_title || row.title}`;

        if (!row.wikilink || !row.wikilink.trim()) {
            await markReleaseVersion(row.id, targetVersion);
            promotedNoLink += 1;
            continue;
        }

        try {
            const html = await getHtml(row.wikilink);
            const freshHash = createHash("sha256").update(html).digest("hex");
            const pageIsMissing = isMissingArticleHtml(html);
            const hashChanged = row.content_hash !== freshHash;

            if (pageIsMissing) {
                await markReleaseVersion(row.id, targetVersion);
                skippedNotAlbumOrMissing += 1;
                console.log(`${prefix} status=skipped_not_album_or_missing release="${releaseName}" wikilink=${row.wikilink}`);
                continue;
            }

            if (!hashChanged) {
                await markReleaseVersion(row.id, targetVersion);
                unchangedHashPromoted += 1;
                continue;
            }

            console.log(`${green}${prefix} status=rescraping release="${releaseName}" wikilink=${row.wikilink}${reset}`);
            const hydrated = await getAlbumReleaseFromApi(row.wikilink);
            if (!hydrated) {
                await markReleaseVersion(row.id, targetVersion);
                skippedNotAlbumOrMissing += 1;
                console.log(`${prefix} status=skipped_not_album_or_missing release="${releaseName}" wikilink=${row.wikilink}`);
                continue;
            }

            const artistTarget = await resolveArtistTarget(hydrated);
            const hasMeaningfulChanges = hasMeaningfulReleaseChanges(row, hydrated, artistTarget);
            if (!hasMeaningfulChanges) {
                await updateContentHashOnly(row.id, freshHash);
                await markReleaseVersion(row.id, targetVersion);
                hashOnlyUpdated += 1;
                rescraped += 1;
                continue;
            }

            if (artistTarget.artist) {
                await discography.upsertRelease(hydrated, artistTarget.artist, freshHash);
            } else {
                await discography.upsertReleaseWithoutArtist(hydrated, freshHash);
            }
            await markReleaseVersion(row.id, targetVersion);
            upserted += 1;
            rescraped += 1;
        } catch (e) {
            failed += 1;
            const message = e instanceof Error ? e.message : String(e);
            console.log(`${prefix} status=failed error=${message} release="${releaseName}" wikilink=${row.wikilink}`);
        }
    }

    console.log(
        `[releases.rescrape] complete target_version=${targetVersion} rescraped=${rescraped} upserted=${upserted} hash_only=${hashOnlyUpdated} unchanged_hash_promoted=${unchangedHashPromoted} promoted_no_wikilink=${promotedNoLink} skipped_not_album_or_missing=${skippedNotAlbumOrMissing} failed=${failed}`,
    );
}

export async function releasesRescrapeCheck(limitArg?: string): Promise<void> {
    await releasesRescrape(limitArg);
}

function parseLimit(value?: string): number | null {
    if (!value) {
        return null;
    }

    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function isMissingArticleHtml(html: string): boolean {
    return /id="noarticletext"/i.test(html) || /Wikipedia does not have an article with this exact name/i.test(html);
}

async function updateContentHashOnly(id: number, contentHash: string): Promise<void> {
    await db`
        update releases
        set content_hash = ${contentHash}::text
        where id = ${id}
    `;
}

async function markReleaseVersion(id: number, targetVersion: number): Promise<void> {
    await db`
        update releases
        set
            scrape_version = ${targetVersion}::integer,
            last_scraped_at = CURRENT_TIMESTAMP
        where id = ${id}
    `;
}

type ArtistTarget = {
    artist: DBArtist | null;
    fallbackArtistWikilink: string;
    fallbackArtistName: string;
    fallbackArtistDisplayName: string;
};

async function resolveArtistTarget(hydrated: Release): Promise<ArtistTarget> {
    const artistWikilink = (hydrated.artist_wikilink || "").trim();
    if (!artistWikilink) {
        const fallbackArtistName = (hydrated.artist_name || hydrated.artist_display_name || "").trim();
        const fallbackArtistDisplayName = (hydrated.artist_display_name || fallbackArtistName).trim();
        return {
            artist: null,
            fallbackArtistWikilink: buildFallbackArtistWikilink(hydrated),
            fallbackArtistName,
            fallbackArtistDisplayName,
        };
    }

    let artist = await artists.getArtistByUrl(artistWikilink);
    if (!artist) {
        await handleArtistLink(artistWikilink);
        artist = await artists.getArtistByUrl(artistWikilink);
    }

    const fallbackArtistName = (hydrated.artist_name || hydrated.artist_display_name || "").trim();
    const fallbackArtistDisplayName = (hydrated.artist_display_name || fallbackArtistName).trim();
    return {
        artist: artist || null,
        fallbackArtistWikilink: buildFallbackArtistWikilink(hydrated),
        fallbackArtistName,
        fallbackArtistDisplayName,
    };
}

function hasMeaningfulReleaseChanges(existing: ReleaseHashRow, hydrated: Release, artistTarget: ArtistTarget): boolean {
    const normalizedType = normalizeReleaseType(hydrated.type || "");
    const originalType = hydrated.type || "";

    if (artistTarget.artist) {
        if ((existing.artist_id || null) !== artistTarget.artist.id) {
            return true;
        }
        if (normalizeString(existing.artist_wikilink) !== normalizeString(artistTarget.artist.wikilink)) {
            return true;
        }
        if (normalizeString(existing.artist_name) !== normalizeString(hydrated.artist_name || artistTarget.artist.artistname)) {
            return true;
        }
        if (normalizeString(existing.artist_display_name) !== normalizeString(hydrated.artist_display_name || hydrated.artist_name || artistTarget.artist.artistname)) {
            return true;
        }
    } else {
        if ((existing.artist_id || null) !== null) {
            return true;
        }
        if (normalizeString(existing.artist_wikilink) !== normalizeString(artistTarget.fallbackArtistWikilink)) {
            return true;
        }
        if (normalizeString(existing.artist_name) !== normalizeString(artistTarget.fallbackArtistName)) {
            return true;
        }
        if (normalizeString(existing.artist_display_name) !== normalizeString(artistTarget.fallbackArtistDisplayName)) {
            return true;
        }
    }

    if (normalizeString(existing.wikilink) !== normalizeString(hydrated.wikilink)) {
        return true;
    }
    if (normalizeNullableNumber(existing.wikipedia_page_id) !== normalizeNullableNumber(hydrated.wikipedia_page_id ?? null)) {
        return true;
    }
    if (normalizeString(existing.title) !== normalizeString(hydrated.name)) {
        return true;
    }
    if (normalizeString(existing.original_title) !== normalizeString(hydrated.original_title || hydrated.name)) {
        return true;
    }
    if (normalizeString(existing.releasetype) !== normalizeString(normalizedType)) {
        return true;
    }
    if (normalizeString(existing.original_releasetype) !== normalizeString(originalType)) {
        return true;
    }
    if (normalizeString(existing.label) !== normalizeString(hydrated.label)) {
        return true;
    }
    if (normalizeString(existing.original_labels_text) !== normalizeString(hydrated.original_labels_text)) {
        return true;
    }
    if (normalizeString(existing.original_categories_text) !== normalizeString(hydrated.original_categories_text)) {
        return true;
    }
    if (normalizeString(existing.genre) !== normalizeString(hydrated.genre)) {
        return true;
    }
    if (normalizeString(existing.original_genre) !== normalizeString(hydrated.original_genre)) {
        return true;
    }
    if (normalizeString(existing.recorded) !== normalizeString(hydrated.recorded)) {
        return true;
    }
    if (normalizeString(existing.studio) !== normalizeString(hydrated.studio)) {
        return true;
    }
    if (normalizeString(existing.producer) !== normalizeString(hydrated.producer)) {
        return true;
    }
    if (normalizeNullableNumber(existing.dateday) !== normalizeNullableNumber(hydrated.day)) {
        return true;
    }
    if (normalizeString(existing.datemonth) !== normalizeString(hydrated.month)) {
        return true;
    }
    if (normalizeNullableNumber(existing.dateyear) !== normalizeNullableNumber(hydrated.year)) {
        return true;
    }
    if (normalizeNullableNumber(existing.number_of_reviews) !== normalizeNullableNumber(hydrated.number_of_reviews)) {
        return true;
    }
    if (normalizeString(existing.review_links) !== normalizeString(hydrated.review_links)) {
        return true;
    }

    return false;
}

function normalizeString(value: string | null | undefined): string {
    return (value || "").trim();
}

function normalizeNullableNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const parsed = typeof value === "number" ? value : parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

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
