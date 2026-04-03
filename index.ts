import {applyRuntimePolyfills} from "./app/runtime/polyfills";

applyRuntimePolyfills();

const args = process.argv.slice(2);
let isShuttingDown = false;
let sigintCount = 0;
const commandsUsingArtistScrape = new Set(["artists", "artist.query", "link.scrape"]);

type CommandHelp = {
    name: string;
    description: string;
};

const COMMAND_HELP: CommandHelp[] = [
    { name: "help", description: "Show all available commands and what they do." },
    { name: "artists", description: "Run the artist peer scraping pipeline." },
    { name: "artist.query <artist_url>", description: "Query artist peers for a specific artist page URL." },
    { name: "artists.reset.all", description: "Reset artist peer/discography progress flags for all artists." },
    { name: "artists.redirect.remove", description: "Remove redirect/duplicate artist rows." },
    { name: "artists.discover.from.page <page_url>", description: "Discover artist links from one Wikipedia page." },
    { name: "artists.discover.common", description: "Discover artists from common yearly/list sources." },
    { name: "artists.discover.labels", description: "Discover artists from record-label pages." },
    { name: "artists.dedupe.pageid", description: "Deduplicate artists by Wikipedia page id." },
    { name: "link.scrape <artist_url>", description: "Scrape and process links from one artist URL." },
    { name: "discography", description: "Run discography scraping for queued artists." },
    { name: "discography.query <artist_url>", description: "Print discography links discovered from an artist page." },
    { name: "discography.missing.link [artist_url]", description: "Find the first artist with a release missing wikilink and suggest a recommended album wikilink." },
    { name: "discography.reset.all", description: "Reset discography progress for all artists." },
    { name: "labels", description: "Run label scraping." },
    { name: "yearly.albums.sync [year] [fresh]", description: "Sync yearly album references (optionally for a specific year). Add 'fresh' to clear release content hashes for that year first." },
    { name: "yearly.albums.missing <year> [full] [fresh]", description: "List releases in a year missing from yearly album references. Add 'fresh' to clear release content hashes before syncing." },
    { name: "yearly.albums.needs_review.mark <year> <album_wikilink>", description: "Mark one yearly album reference as needs review." },
    { name: "yearly.albums.needs_review.list [year]", description: "List yearly album references marked needs review." },
    { name: "yearly.albums.unlinked <year>", description: "Find unlinked album rows on yearly list pages and suggest links." },
    { name: "yearly.albums.cited.reviews <year> [min_reviews]", description: "List albums that have a Ref citation on yearly list page(s) and at least min reviews in releases (default 3)." },
];

if (args.length > 3) {
    console.log("too many arguments");
}

function printHelp(): void {
    console.log("Available commands:");
    for (const command of COMMAND_HELP) {
        console.log(`- ${command.name}: ${command.description}`);
    }
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
    if (!args[0]) {
        printHelp();
        return;
    }

    switch (args[0]) {
        case 'help': {
            printHelp();
            return;
        }
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
        case 'discography.missing.link': {
            const { discographyMissingWikilink } = await import("./app/discography/query/missingwikilink");
            await discographyMissingWikilink(args[1]);
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
            await syncYearlyAlbumReferences(args[1], args[2]);
            return;
        }
        case 'yearly.albums.missing': {
            const { yearlyAlbumsMissingFromReference } = await import("./app/yearlyalbums/query/missingfromreference");
            await yearlyAlbumsMissingFromReference(args[1], args[2], args[3]);
            return;
        }
        case 'yearly.albums.needs_review.mark': {
            const { yearlyAlbumsNeedsReviewMark } = await import("./app/yearlyalbums/query/needsreview");
            await yearlyAlbumsNeedsReviewMark(args[1], args[2]);
            return;
        }
        case 'yearly.albums.needs_review.list': {
            const { yearlyAlbumsNeedsReviewList } = await import("./app/yearlyalbums/query/needsreview");
            await yearlyAlbumsNeedsReviewList(args[1]);
            return;
        }
        case 'yearly.albums.unlinked': {
            const { yearlyAlbumsUnlinked } = await import("./app/yearlyalbums/query/unlinkedfromlist");
            await yearlyAlbumsUnlinked(args[1]);
            return;
        }
        case 'yearly.albums.cited.reviews': {
            const { yearlyAlbumsCitedReviews } = await import("./app/yearlyalbums/query/citedwithreviews");
            await yearlyAlbumsCitedReviews(args[1], args[2]);
            return;
        }
        default:
            console.log("command not recognized");
            console.log("");
            printHelp();
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
