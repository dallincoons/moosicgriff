import artists from "app/repositories/artists/artists";
import discography from "app/repositories/discography/discography";
import {getDiscographyFromArtists} from "./chat";
import {DBArtist} from "../artists/artist";
import {parseReleases} from "app/discography/parse"
import {Release} from "./release";
import {getSectionText} from "app/clients/wikipedia";

export async function scrape() {
    const artist:DBArtist = await <DBArtist>artists.getWhereDiscographyNotFound();

    if (!artist) {
        console.log("No more artists to process for discography. Exiting gracefully.");
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

    for (const release of releases) {
        await discography.insertRelease(release, artist);
    }

    await artists.markAsDiscographyFound(artist.wikilink);

    return await scrape();
}

export async function getDiscographyFromDiscographyPage(artistLink:string) {
    let content = '';

    try {
        content = await getSectionText(artistLink + "_discography", "Albums", "References");
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
    let content = "";

    console.log(`${artistLink}: fetching discography from the artist page`);

    try {
        content = await getSectionText(artistLink, "Discography", "References");
    } catch (e: any) {
        if (e.status == 404) {
        }
        return [];
    }

    console.log(content);

    return await getDiscographyFromArtists(content);
}
