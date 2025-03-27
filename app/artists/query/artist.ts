import { getArtistPeersFromUrl } from 'app/artists/scrape';

export async function artistQuery(artistUrl: string = 'https://en.wikipedia.org/wiki/Nirvana_(band)') {
    console.log(await getArtistPeersFromUrl(artistUrl));
}
