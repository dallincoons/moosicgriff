import {getDiscographyFromArtistPage} from "../scrape";

export async function discographyQuery(artistUrl: string = 'https://en.wikipedia.org/wiki/Nirvana_(band)') {
    console.log(await getDiscographyFromArtistPage(artistUrl));
}
