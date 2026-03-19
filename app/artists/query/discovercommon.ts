import {artistsDiscoverFromPage} from "app/artists/query/discoverfrompage";
import {getListItemWikiLinks} from "app/clients/wikipedia";

const FIRST_DISCOVERY_YEAR = 1960;
const DISCOVERY_PAGE_OVERRIDES: Record<number, string[]> = {
    2021: [
        "https://en.wikipedia.org/wiki/List_of_2021_albums_(January%E2%80%93June)",
        "https://en.wikipedia.org/wiki/List_of_2021_albums_(July%E2%80%93December)",
    ],
};
const RECORD_LABEL_INDEX_PAGES = [
    "https://en.wikipedia.org/wiki/List_of_record_labels%3A_A%E2%80%93H",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_I%E2%80%93Q",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_R%E2%80%93Z",
    "https://en.wikipedia.org/wiki/List_of_record_labels:_0%E2%80%939",
];

export async function artistsDiscoverCommon(): Promise<void> {
    const currentYear = new Date().getUTCFullYear();
    const pages = buildCommonDiscoveryPages(FIRST_DISCOVERY_YEAR, currentYear);

    console.log(`[artists.discover.common] processing ${pages.length} discovery pages`);
    for (let i = 0; i < pages.length; i++) {
        const pageUrl = pages[i];
        console.log(`[artists.discover.common] page ${i + 1}/${pages.length}: ${pageUrl}`);
        await artistsDiscoverFromPage(pageUrl);
    }

    await discoverFromRecordLabelPages();

    console.log("[artists.discover.common] complete.");
}

function buildCommonDiscoveryPages(startYear: number, endYear: number): string[] {
    const pages: string[] = [];
    for (let year = startYear; year <= endYear; year++) {
        const overrides = DISCOVERY_PAGE_OVERRIDES[year];
        if (overrides && overrides.length > 0) {
            pages.push(...overrides);
            continue;
        }
        pages.push(`https://en.wikipedia.org/wiki/List_of_${year}_albums`);
    }
    return pages;
}

async function discoverFromRecordLabelPages(): Promise<void> {
    const labelPages = new Set<string>();
    console.log(`[artists.discover.common] collecting label pages from ${RECORD_LABEL_INDEX_PAGES.length} index pages`);

    for (let i = 0; i < RECORD_LABEL_INDEX_PAGES.length; i++) {
        const indexPage = RECORD_LABEL_INDEX_PAGES[i];
        console.log(`[artists.discover.common] label index ${i + 1}/${RECORD_LABEL_INDEX_PAGES.length}: ${indexPage}`);
        const links = await getListItemWikiLinks(indexPage);

        for (const link of links) {
            if (link.includes("/wiki/List_of_record_labels")) {
                continue;
            }
            labelPages.add(link);
        }
    }

    const allLabelPages = [...labelPages];
    console.log(`[artists.discover.common] discovered ${allLabelPages.length} label pages`);

    for (let i = 0; i < allLabelPages.length; i++) {
        const labelPage = allLabelPages[i];
        console.log(`[artists.discover.common] label page ${i + 1}/${allLabelPages.length}: ${labelPage}`);
        await artistsDiscoverFromPage(labelPage);
    }
}
