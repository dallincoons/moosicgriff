import * as cheerio from "cheerio";
import artists from "app/repositories/artists/artists";
import discography from "app/repositories/discography/discography";
import {getDiscographyFromArtists} from "./chat";
import {DBArtist} from "../artists/artist";
import {parseReleases} from "app/discography/parse"

export async function scrape() {
    const artist = await <DBArtist>artists.getWhereDiscographyNotFound();

    if (!artist) {
        return;
    }

    let artistLink = artist.wikilink;
    // let artistLink = "https://en.wikipedia.org/wiki/Nirvana_(band)";
    let response;

    response = await getDiscographyFromDiscographyPage(artistLink);

    console.log({response});

    if (!response || response.length === 0) {
        response = await getDiscographyFromArtistPage(artistLink);
    }

    const releases = parseReleases(<string>response);

    releases.forEach(async (release) => {
        await discography.insertRelease(release, artist);
    });

    await artists.markAsDiscographyFound(artist.wikilink);

    scrape();

    return;
}

async function getDiscographyFromDiscographyPage(artistLink:string) {
    let $;

    try {
        let pattern = /(.+)_\(.+/
        let matches = pattern.exec(artistLink);
        if (matches && matches.length > 1) {
            const discogLink = `${matches[1]}_discography`;
            $ = await cheerio.fromURL(discogLink);
        } else {
            $ = await cheerio.fromURL(artistLink);
        }
    } catch (e: any) {
        if (e.status == 404) {
        }
        return [];
    }

    let base: string = "h2:contains('Albums')";
    let content = $(base).parent().nextUntil("h2:contains('References')").text();

    return await getDiscographyFromArtists(content);
}

async function getDiscographyFromArtistPage(artistLink:string) {
    let $;

    try {
        $ = await cheerio.fromURL(artistLink);
    } catch (e: any) {
        if (e.status == 404) {
        }
        return [];
    }

    let base: string = "h2:contains('Discography')";
    let content = $(base).parent().nextUntil("h2:contains('References')").text();

    console.log({content});

    return await getDiscographyFromArtists(content);
}
