import artists from "app/repositories/artists/artists";
import discography from "app/repositories/discography/discography";
import discographyDeadlinks from "app/repositories/discographydeadlinks/discographydeadlinks";
import {handleLink as handleArtistLink} from "app/artists/scrape";
import {Release} from "./release";
import {getHtml, getSectionWikiLinks, isMissingArticlePage} from "app/clients/wikipedia";
import {createHash} from "crypto";
import {getAlbumReleaseFromApi} from "app/clients/wikipediaapi";

export async function scrape() {
    const artist = await artists.getWhereDiscographyNotFound();

    if (!artist) {
        console.log("No more artists to process for discography. Exiting gracefully.");
        return;
    }

    let artistLink = artist.wikilink;
    let releaseLinks: string[] = [];

    console.log("");
    console.log("fetching discography for: " + artist.artistname + ", " + artistLink);

    releaseLinks = await getDiscographyFromDiscographyPage(artistLink);

    if (releaseLinks.length === 0) {
        releaseLinks = await getDiscographyFromArtistPage(artistLink);
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

    await artists.markAsDiscographyFound(artist.wikilink);
    console.log(`[discography] ${artist.artistname}: marked discography complete`);
    console.log("");

    return await scrape();
}

export async function getDiscographyFromDiscographyPage(artistLink:string) {
    try {
        const discographyUrl = artistLink + "_discography";
        if (await isMissingArticlePage(discographyUrl)) {
            console.log(`${discographyUrl}: no exact discography article; falling back to artist page`);
            return [];
        }

        const links = await getSectionWikiLinks(discographyUrl, "Albums", "References");
        console.log(`discography page found: ${discographyUrl}`);
        return links;
    } catch (e: any) {
        if (e.status == 404) {
            console.log(artistLink + ": no discography page detected");
        }
        return [];
    }
}

export async function getDiscographyFromArtistPage(artistLink:string) {
    console.log(`${artistLink}: fetching discography from the artist page`);

    try {
        const links = await getSectionWikiLinks(artistLink, "Discography", "References");
        return links;
    } catch (e: any) {
        if (e.status == 404) {
        }
        return [];
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
