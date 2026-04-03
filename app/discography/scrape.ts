import artists from "app/repositories/artists/artists";
import discography from "app/repositories/discography/discography";
import discographyDeadlinks from "app/repositories/discographydeadlinks/discographydeadlinks";
import {handleLink as handleArtistLink} from "app/artists/scrape";
import {Release} from "./release";
import {getHtml, getSectionWikiLinks, isMissingArticlePage} from "app/clients/wikipedia";
import {createHash} from "crypto";
import {getAlbumReleaseFromApi} from "app/clients/wikipediaapi";

export async function scrape(runStartedAt: Date = new Date()) {
    const artist = await artists.getWhereDiscographyNotFound(runStartedAt);

    if (!artist) {
        console.log("No more artists to process for discography. Exiting gracefully.");
        return;
    }

    let artistLink = artist.wikilink;
    let releaseLinks: string[] = [];
    let discographySource: DiscographySource | null = null;

    console.log("");
    console.log("fetching discography for: " + artist.artistname + ", " + artistLink);

    discographySource = await getDiscographySource(artistLink);
    releaseLinks = discographySource?.releaseLinks || [];

    if (
        discographySource &&
        artist.discography_wikilink === discographySource.sourceWikilink &&
        artist.discography_content_hash === discographySource.sourceContentHash
    ) {
        console.log(
            `[discography] ${artist.artistname}: no discography source changes (${discographySource.sourceWikilink}); skipping release updates`,
        );
        const hasMissingWikilinks = await artists.refreshHasMissingReleaseWikilinks(artist.wikilink);
        console.log(`[discography] ${artist.artistname}: has_missing_release_wikilinks=${hasMissingWikilinks}`);
        await artists.markAsDiscographyFound(artist.wikilink);
        console.log(`[discography] ${artist.artistname}: marked discography complete`);
        console.log("");
        return await scrape(runStartedAt);
    }

    console.log(`[discography] ${artist.artistname}: ${releaseLinks.length} candidate links found`);
    const hydration = await hydrateReleasesFromLinks(artist.wikilink, releaseLinks);
    const releases = hydration.releases;

    console.log(`[discography] ${artist.artistname}: ${releases.length} releases to upsert (${hydration.skippedKnownNonAlbum} known non-albums, ${hydration.skippedUnchanged} unchanged, ${hydration.skippedNonAlbum} not albums, ${hydration.errors} errors)`);

    let upserted = 0;
    for (const release of releases) {
        if (!release.contentHash) {
            continue;
        }
        await discography.upsertRelease(release.release, artist, release.contentHash);
        upserted += 1;
    }
    console.log(`[discography] ${artist.artistname}: upserted ${upserted} releases`);

    await artists.updateDiscographySourceState(
        artist.wikilink,
        discographySource?.sourceWikilink || null,
        discographySource?.sourceContentHash || null,
    );
    const hasMissingWikilinks = await artists.refreshHasMissingReleaseWikilinks(artist.wikilink);
    console.log(`[discography] ${artist.artistname}: has_missing_release_wikilinks=${hasMissingWikilinks}`);
    await artists.markAsDiscographyFound(artist.wikilink);
    console.log(`[discography] ${artist.artistname}: marked discography complete`);
    console.log("");

    return await scrape(runStartedAt);
}

export async function getDiscographyFromDiscographyPage(artistLink:string) {
    const source = await fetchDiscographySourceWithStartHeaders(
        artistLink + "_discography",
        ["Albums", "Studio albums", "Discography"],
        "References",
    );
    return source?.releaseLinks || [];
}

export async function getDiscographyFromArtistPage(artistLink:string) {
    console.log(`${artistLink}: fetching discography from the artist page`);

    const source = await fetchDiscographySource(artistLink, "Discography", "References");
    return source?.releaseLinks || [];
}

type DiscographySource = {
    sourceWikilink: string;
    sourceContentHash: string;
    releaseLinks: string[];
};

async function getDiscographySource(artistLink: string): Promise<DiscographySource | null> {
    const discographyUrl = `${artistLink}_discography`;
    const discographySource = await fetchDiscographySourceWithStartHeaders(
        discographyUrl,
        ["Albums", "Studio albums", "Discography"],
        "References",
    );
    if (discographySource && discographySource.releaseLinks.length > 0) {
        console.log(`discography page found: ${discographyUrl}`);
        return discographySource;
    }

    if (!discographySource) {
        console.log(`${discographyUrl}: no exact discography article; falling back to artist page`);
    }

    console.log(`${artistLink}: fetching discography from the artist page`);
    return await fetchDiscographySource(artistLink, "Discography", "References");
}

async function fetchDiscographySourceWithStartHeaders(
    sourceWikilink: string,
    startHeaders: string[],
    endHeader: string,
): Promise<DiscographySource | null> {
    for (const startHeader of startHeaders) {
        const source = await fetchDiscographySource(sourceWikilink, startHeader, endHeader);
        if (source && source.releaseLinks.length > 0) {
            return source;
        }
    }
    return null;
}

async function fetchDiscographySource(
    sourceWikilink: string,
    startHeader: string,
    endHeader: string,
): Promise<DiscographySource | null> {
    try {
        if (await isMissingArticlePage(sourceWikilink)) {
            return null;
        }

        const html = await getHtml(sourceWikilink);
        const links = await getSectionWikiLinks(sourceWikilink, startHeader, endHeader);
        return {
            sourceWikilink,
            sourceContentHash: hashContent(html),
            releaseLinks: links,
        };
    } catch (e: any) {
        if (e.status == 404) {
            return null;
        }
        return null;
    }
}

async function hydrateReleasesFromLinks(artistWikilink: string, links: string[]): Promise<{
    releases: Array<{release: Release; contentHash: string}>;
    skippedKnownNonAlbum: number;
    skippedUnchanged: number;
    skippedNonAlbum: number;
    errors: number;
}> {
    const releases: Array<{release: Release; contentHash: string}> = [];
    const uniqueLinks = [...new Set(links)];
    let skippedKnownNonAlbum = 0;
    let skippedUnchanged = 0;
    let skippedNonAlbum = 0;
    let errors = 0;
    let processed = 0;

    for (const link of uniqueLinks) {
        processed += 1;
        if (processed % 10 === 0 || processed === uniqueLinks.length) {
            console.log(`[discography] processed ${processed}/${uniqueLinks.length} candidate links`);
        }
        try {
            if (await discographyDeadlinks.doesDeadLinkExist(link)) {
                skippedKnownNonAlbum += 1;
                continue;
            }

            const release = await buildReleaseIfAlbum(artistWikilink, link);
            if (release?.reason === "ok") {
                releases.push(release);
            } else if (release?.reason === "unchanged") {
                skippedUnchanged += 1;
            } else if (release?.reason === "not_album") {
                skippedNonAlbum += 1;
                await discographyDeadlinks.insertNew(link);
            }
        } catch (e) {
            errors += 1;
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`[discography] error processing ${link}: ${errorMessage}`);
        }
    }

    return { releases, skippedKnownNonAlbum, skippedUnchanged, skippedNonAlbum, errors };
}

async function buildReleaseIfAlbum(
    artistWikilink: string,
    link: string,
): Promise<({release: Release; contentHash: string; reason: "ok"}) | {reason: "unchanged"} | {reason: "not_album"}> {
    const html = await getHtml(link);
    if (!looksLikeAlbumHtml(html)) {
        return { reason: "not_album" };
    }

    const contentHash = hashContent(html);
    const existing = await discography.getReleaseByArtistAndLink(artistWikilink, link);
    if (existing?.content_hash === contentHash) {
        return { reason: "unchanged" };
    }

    const release = await getAlbumReleaseFromApi(link);
    if (!release) {
        return { reason: "not_album" };
    }
    await ensureArtistExistsForRelease(artistWikilink, link, release);

    return { release, contentHash, reason: "ok" };
}

function hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

function looksLikeAlbumHtml(html: string): boolean {
    return /infobox[^>]*album/i.test(html) || /Template:Infobox_album/i.test(html);
}

async function ensureArtistExistsForRelease(parentArtistWikilink: string, albumWikilink: string, release: Release): Promise<void> {
    const albumArtistWikilink = (release.artist_wikilink || "").trim();
    if (!albumArtistWikilink) {
        return;
    }

    if (await artists.getArtistByUrl(albumArtistWikilink)) {
        return;
    }

    console.log(`[discography] discovered missing artist from album "${albumWikilink}": ${albumArtistWikilink}; scraping link`);
    await handleArtistLink(albumArtistWikilink, parentArtistWikilink);
}
