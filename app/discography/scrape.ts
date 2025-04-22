import * as cheerio from "cheerio";
import artists from "app/repositories/artists/artists";
import discography from "app/repositories/discography/discography";
import {getDiscographyFromArtists} from "./chat";
import {DBArtist} from "../artists/artist";
import {parseReleases} from "app/discography/parse"
import {Release} from "./release";

export async function scrape() {
    const artist:DBArtist = await <DBArtist>artists.getWhereDiscographyNotFound();

    if (!artist) {
        return;
    }

    let artistLink = artist.wikilink;
    let response;

    console.log("fetching discography for: " + artist.artistname + ", " + artistLink);

    response = await getDiscographyFromDiscographyPage(artistLink);

    if (!response || response.length === 0) {
        response = await getDiscographyFromArtistPage(artistLink);
    }

    const releases = parseReleases(<string>response);

    console.log(`${releases.length} releases found for ${artistLink} `);

    releases.forEach(async (release: Release) => {
        await discography.insertRelease(release, artist);
    });

    await artists.markAsDiscographyFound(artist.wikilink);

    scrape();

    return;
}

export async function getDiscographyFromDiscographyPage(artistLink:string) {
    let content = '';

    try {
        let $;
        // let pattern = /(.+)_\(.+/
        // let matches = pattern.exec(artistLink);
        // if (matches && matches.length > 1) {
        //     const discogLink = `${matches[1]}_discography`;
        //     console.log(`discography page found: ${discogLink}`);
        //     $ = await cheerio.fromURL(discogLink);
        // } else {
        //     $ = await cheerio.fromURL(artistLink);
        // }

        $ = await cheerio.fromURL(artistLink + "_discography");

        let base: string = "h2:contains('Albums')";
        content = $(base).parent().nextUntil("h2:contains('References')").text();
    } catch (e: any) {
        if (e.status == 404) {
            console.log(artistLink + ": no discography page detected");
        }
        return [];
    }

    console.log(`discography page found: ${artistLink + "_discography"}`);

    return await getDiscographyFromArtists(content);
}

export async function getDiscographyFromArtistPage(artistLink:string) {
    let $;

    console.log(`${artistLink}: fetching discography from the artist page`);

    try {
        $ = await cheerio.fromURL(artistLink);
    } catch (e: any) {
        if (e.status == 404) {
        }
        return [];
    }

    let base: string = "h2:contains('Discography')";
    let content = $(base).parent().nextUntil("h2:contains('References')").text();

    console.log(content);

    return await getDiscographyFromArtists(content);
}
