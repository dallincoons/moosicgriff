import * as cheerio from "cheerio";
import artists from "app/repositories/artists/artists";
import {getDiscographyFromArtists} from "./chat";
import {DBArtist} from "../artists/artist";
import {parseReleases} from "app/discography/parse"

export async function scrape() {
    // const artist = await <DBArtist>artists.getWhereNotInDiscography();
    //
    // if (!artist) {
    //     return;
    // }
    //
    // let artistLink = artist.wikilink;
    let response;
    let artistLink = "https://en.wikipedia.org/wiki/Nirvana_(band)";

    response = await getDiscographyFromDiscographyPage(artistLink);

    if (!response) {
        response = await getDiscographyFromArtistPage(artistLink);
    }

    console.log(response);
    console.log(parseReleases(<string>response));

    // let releases = parseReleases();
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

    return await getDiscographyFromArtists(content);
}
