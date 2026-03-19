import artists from "app/repositories/artists/artists";
import {resolveWikipediaRedirect} from "app/clients/wikipedia";

export async function artistsDedupePageId(): Promise<void> {
    const rows = await artists.getAll();
    const keeperByPageId = new Map<number, number>();
    const deletedIds = new Set<number>();

    let scanned = 0;
    let updatedIdentity = 0;
    let removedDuplicates = 0;
    let unresolved = 0;

    for (const row of rows) {
        if (deletedIds.has(row.id)) {
            continue;
        }

        scanned += 1;
        console.log(
            `[artists.dedupe.pageid] checking artist id=${row.id}, artist=${row.artistname}, wikilink=${row.wikilink}, existing_page_id=${row.wikipedia_page_id}`,
        );
        const redirect = await resolveWikipediaRedirect(row.wikilink);
        const canonicalUrl = redirect.resolvedUrl || row.wikilink;
        const pageId = redirect.pageId;

        const existingByCanonicalUrl = await artists.getArtistByUrl(canonicalUrl);
        if (existingByCanonicalUrl && existingByCanonicalUrl.id !== row.id) {
            if (pageId && existingByCanonicalUrl.wikipedia_page_id !== pageId) {
                console.log(
                    `[artists.dedupe.pageid] setting wikipedia_page_id=${pageId} on canonical artist id=${existingByCanonicalUrl.id}, artist=${existingByCanonicalUrl.artistname}, wikilink=${canonicalUrl}`,
                );
                await artists.updateWikipediaPageIdById(existingByCanonicalUrl.id, pageId);
                updatedIdentity += 1;
            }

            await artists.deleteById(row.id);
            deletedIds.add(row.id);
            removedDuplicates += 1;
            console.log(`[artists.dedupe.pageid] removed duplicate id=${row.id}, wikilink=${row.wikilink}, canonical=${canonicalUrl}`);
            continue;
        }

        if (row.wikilink !== canonicalUrl || row.wikipedia_page_id !== pageId) {
            console.log(
                `[artists.dedupe.pageid] updating artist id=${row.id}, artist=${row.artistname}, canonical=${canonicalUrl}, wikipedia_page_id=${pageId}`,
            );
            await artists.updateWikipediaIdentityById(row.id, canonicalUrl, pageId);
            updatedIdentity += 1;
        }

        if (!pageId) {
            unresolved += 1;
            console.log(`[artists.dedupe.pageid] unresolved page id for artist id=${row.id}, wikilink=${row.wikilink}`);
            continue;
        }

        const keeperId = keeperByPageId.get(pageId);
        if (!keeperId) {
            keeperByPageId.set(pageId, row.id);
            continue;
        }

        if (keeperId === row.id) {
            continue;
        }

        await artists.deleteById(row.id);
        removedDuplicates += 1;
        console.log(`[artists.dedupe.pageid] removed duplicate id=${row.id}, wikilink=${row.wikilink}, page_id=${pageId}`);
    }

    console.log(
        `[artists.dedupe.pageid] complete. scanned=${scanned}, updated=${updatedIdentity}, removed_duplicates=${removedDuplicates}, unresolved=${unresolved}`,
    );
}
