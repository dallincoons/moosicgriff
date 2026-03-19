import artists from "app/repositories/artists/artists";
import {isWikipediaDisambiguationPage, resolveWikipediaRedirect} from "app/clients/wikipedia";
import {getBandName} from "app/artists/chat";

export async function artistsRedirectRemove(): Promise<void> {
    const allArtists = await artists.getAll();
    let redirectRows = 0;
    let insertedTargets = 0;
    let removedRedirectRows = 0;
    let alreadyExistingTargets = 0;
    let skippedDisambiguationTargets = 0;

    for (const artist of allArtists) {
        const redirect = await resolveWikipediaRedirect(artist.wikilink);
        if (!redirect.isRedirect || redirect.originalUrl === redirect.resolvedUrl) {
            continue;
        }

        redirectRows += 1;
        if (await isWikipediaDisambiguationPage(redirect.resolvedUrl)) {
            skippedDisambiguationTargets += 1;
            await artists.delete(artist.wikilink);
            removedRedirectRows += 1;
            console.log(`[artists.redirect.remove] skipped disambiguation target: ${redirect.resolvedUrl}`);
            console.log(`[artists.redirect.remove] removed redirect row: ${artist.wikilink}`);
            continue;
        }

        const existingTarget = redirect.pageId
            ? await artists.getArtistByWikipediaPageId(redirect.pageId)
            : await artists.getArtistByUrl(redirect.resolvedUrl);
        if (existingTarget) {
            alreadyExistingTargets += 1;
        } else {
            const resolvedName = await getBandName(redirect.resolvedUrl);
            const artistName = resolvedName || nameFromWikiUrl(redirect.resolvedUrl) || artist.artistname;
            await artists.insertNew(artistName, redirect.resolvedUrl, artist.parent_wikilink, redirect.pageId);
            insertedTargets += 1;
            console.log(`[artists.redirect.remove] inserted target: ${redirect.resolvedUrl}`);
        }

        await artists.delete(artist.wikilink);
        removedRedirectRows += 1;
        console.log(`[artists.redirect.remove] removed redirect row: ${artist.wikilink}`);
    }

    console.log(
        `[artists.redirect.remove] complete. redirects=${redirectRows}, inserted=${insertedTargets}, existing=${alreadyExistingTargets}, skipped_disambiguation=${skippedDisambiguationTargets}, removed=${removedRedirectRows}`,
    );
}

function nameFromWikiUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const title = decodeURIComponent(parsed.pathname.replace(/^\/wiki\//, ""))
            .replace(/_/g, " ")
            .trim();
        return title.replace(/\s*\([^)]*\)\s*$/g, "").trim();
    } catch (e) {
        return "";
    }
}
