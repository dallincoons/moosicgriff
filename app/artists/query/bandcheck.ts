import {handleExplicitArtistLink} from "../scrape";

export async function bandCheck(artistUrl: string = 'https://en.wikipedia.org/wiki/Nirvana_(band)') {
    await handleExplicitArtistLink(artistUrl);
}
