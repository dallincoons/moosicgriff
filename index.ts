import {applyRuntimePolyfills} from "./app/runtime/polyfills";

applyRuntimePolyfills();

const args = process.argv.slice(2);
let isShuttingDown = false;
let sigintCount = 0;
const commandsUsingArtistScrape = new Set(["artists", "artist.query", "link.scrape"]);

if (args.length > 3) {
    console.log("too many arguments");
}

async function shutdown(): Promise<void> {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;

    if (args[0] === "artists") {
        try {
            const { printRunSummary } = await import("./app/artists/runsummary");
            printRunSummary();
        } catch (e) {
        }
    }

    if (commandsUsingArtistScrape.has(args[0])) {
        try {
            const { closeArtistScrapeResources } = await import("./app/artists/scrape");
            closeArtistScrapeResources();
        } catch (e) {
        }
    }

    try {
        const { closeDb } = await import("./app/repositories/db");
        await closeDb();
    } catch (e) {
    }
}

async function main(): Promise<void> {
    switch (args[0]) {
        case 'artists': {
            const { scrape } = await import("./app/artists/scrape");
            await scrape();
            return;
        }
        case 'artist.query': {
            const { artistQuery } = await import("./app/artists/query/artist");
            await artistQuery(args[1]);
            return;
        }
        case 'artists.reset.all': {
            const { artistsRerunAll } = await import("./app/artists/query/resetall");
            await artistsRerunAll();
            return;
        }
        case 'artists.redirect.remove': {
            const { artistsRedirectRemove } = await import("./app/artists/query/redirectremove");
            await artistsRedirectRemove();
            return;
        }
        case 'artists.discover.from.page': {
            const { artistsDiscoverFromPage } = await import("./app/artists/query/discoverfrompage");
            await artistsDiscoverFromPage(args[1]);
            return;
        }
        case 'artists.discover.common': {
            const { artistsDiscoverCommon } = await import("./app/artists/query/discovercommon");
            await artistsDiscoverCommon();
            return;
        }
        case 'artists.discover.labels': {
            const { artistsDiscoverLabels } = await import("./app/artists/query/discoverlabels");
            await artistsDiscoverLabels();
            return;
        }
        case 'artists.dedupe.pageid': {
            const { artistsDedupePageId } = await import("./app/artists/query/dedupepageid");
            await artistsDedupePageId();
            return;
        }
        case 'link.scrape': {
            const { bandCheck } = await import("./app/artists/query/bandcheck");
            await bandCheck(args[1]);
            return;
        }
        case 'discography': {
            const { scrape } = await import("./app/discography/scrape");
            await scrape();
            return;
        }
        case 'discography.query': {
            const { discographyQuery } = await import("./app/discography/query/fromartistpage");
            await discographyQuery(args[1]);
            return;
        }
        case 'discography.reset.all': {
            const { discographyResetAll } = await import("./app/discography/query/resetall");
            await discographyResetAll();
            return;
        }
        case 'labels': {
            const { scrape } = await import("./app/labels/scrape");
            await scrape();
            return;
        }
        case 'yearly.albums.sync': {
            const { syncYearlyAlbumReferences } = await import("./app/yearlyalbums/sync");
            await syncYearlyAlbumReferences(args[1]);
            return;
        }
        case 'yearly.albums.missing': {
            const { yearlyAlbumsMissingFromReference } = await import("./app/yearlyalbums/query/missingfromreference");
            await yearlyAlbumsMissingFromReference(args[1], args[2]);
            return;
        }
        default:
            console.log("command not recognized");
    }
}

process.on("SIGINT", async () => {
    sigintCount += 1;

    if (sigintCount === 1) {
        process.exitCode = 130;

        try {
            const { requestStop } = await import("./app/runtime/stop");
            requestStop();
        } catch (e) {
        }

        if (args[0] === "artists") {
            try {
                const { printRunSummary } = await import("./app/artists/runsummary");
                printRunSummary();
            } catch (e) {
            }
        }

        process.exit(130);
    }

    console.log("Force exiting.");
    process.exit(130);
});

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await shutdown();
    });
