import {artistsDiscoverFromPage} from "app/artists/query/discoverfrompage";
import {getListItemWikiLinks} from "app/clients/wikipedia";

const RECORD_LABEL_INDEX_PAGES = [
    "https://en.wikipedia.org/wiki/List_of_record_labels%3A_A%E2%80%93H",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_I%E2%80%93Q",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_R%E2%80%93Z",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_0%E2%80%939",
];

export async function artistsDiscoverLabels(): Promise<void> {
    const labelPages = new Set<string>();
    console.log(`[artists.discover.labels] collecting label pages from ${RECORD_LABEL_INDEX_PAGES.length} index pages`);

    for (let i = 0; i < RECORD_LABEL_INDEX_PAGES.length; i++) {
        const indexPage = RECORD_LABEL_INDEX_PAGES[i];
        console.log(`[artists.discover.labels] label index ${i + 1}/${RECORD_LABEL_INDEX_PAGES.length}: ${indexPage}`);
        const links = await getListItemWikiLinks(indexPage);

        for (const link of links) {
            if (link.includes("/wiki/List_of_record_labels")) {
                continue;
            }
            labelPages.add(link);
        }
    }

    const allLabelPages = [...labelPages];
    console.log(`[artists.discover.labels] discovered ${allLabelPages.length} label pages`);

    for (let i = 0; i < allLabelPages.length; i++) {
        const labelPage = allLabelPages[i];
        console.log(`[artists.discover.labels] label page ${i + 1}/${allLabelPages.length}: ${labelPage}`);
        await artistsDiscoverFromPage(labelPage);
    }

    console.log("[artists.discover.labels] complete.");
}

