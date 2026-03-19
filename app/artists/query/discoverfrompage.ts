import {getArtistPeersFromUrl, handleLink} from "app/artists/scrape";

const DEFAULT_DISCOVERY_PAGE = "https://en.wikipedia.org/wiki/List_of_2025_albums";

export async function artistsDiscoverFromPage(pageUrl: string = DEFAULT_DISCOVERY_PAGE): Promise<void> {
    console.log(`[artists.discover.from.page] source: ${pageUrl}`);

    const links = await getArtistPeersFromUrl(pageUrl);
    const uniqueLinks = [...new Set(links)];
    console.log(`[artists.discover.from.page] ${uniqueLinks.length} candidate links`);

    let processed = 0;
    for (const link of uniqueLinks) {
        processed += 1;
        if (processed % 25 === 0 || processed === uniqueLinks.length) {
            console.log(`[artists.discover.from.page] processed ${processed}/${uniqueLinks.length}`);
        }
        await handleLink(link, pageUrl);
    }

    console.log("[artists.discover.from.page] complete.");
}

