import {getArtistPeersFromUrl, handleLink} from "../scrape";

export async function bandCheck(artistUrl: string = 'https://en.wikipedia.org/wiki/Nirvana_(band)') {
    console.log(await handleLink(artistUrl));
}
