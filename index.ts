import {applyRuntimePolyfills} from "./app/runtime/polyfills";

applyRuntimePolyfills();

const args = process.argv.slice(2);
let isShuttingDown = false;
let sigintCount = 0;
const commandsUsingArtistScrape = new Set(["artists", "artist.query", "link.scrape"]);

type CommandHelp = {
    name: string;
    description: string;
    section: string;
};

const COMMAND_HELP: CommandHelp[] = [
    { name: "help", description: "Show all available commands and what they do.", section: "General" },
    { name: "artists", description: "Run the artist peer scraping pipeline.", section: "Artists" },
    { name: "artist.query <artist_url>", description: "Query artist peers for a specific artist page URL.", section: "Artists" },
    { name: "artists.reset.all", description: "Reset artist peer/discography progress flags for all artists.", section: "Artists" },
    { name: "artists.redirect.remove", description: "Remove redirect/duplicate artist rows.", section: "Artists" },
    { name: "artists.years_active.backfill", description: "Reset and backfill artist year_start/year_end from infobox years_active.", section: "Artists" },
    { name: "artists.discover.from.page <page_url>", description: "Discover artist links from one Wikipedia page.", section: "Artists" },
    { name: "artists.discover.common", description: "Discover artists from common yearly/list sources.", section: "Artists" },
    { name: "artists.discover.labels", description: "Discover artists from record-label pages.", section: "Artists" },
    { name: "artists.dedupe.pageid", description: "Deduplicate artists by Wikipedia page id.", section: "Artists" },
    { name: "artists.active.current_year.albums.sync [year] [output_file]", description: "Scan active artists for current-year albums and output missing candidates (optionally write report to file).", section: "Artists" },
    { name: "link.scrape <artist_url>", description: "Scrape and process links from one artist URL.", section: "Artists" },
    { name: "discography", description: "Run discography scraping for queued artists.", section: "Discography & Releases" },
    { name: "discography.query <artist_url>", description: "Print discography links discovered from an artist page.", section: "Discography & Releases" },
    { name: "discography.missing.link [artist_url]", description: "Find the first artist with a release missing wikilink and suggest a recommended album wikilink.", section: "Discography & Releases" },
    { name: "discography.reset.all", description: "Reset discography progress for all artists.", section: "Discography & Releases" },
    { name: "releases.artist_id.backfill", description: "Backfill releases.artist_id from artists.wikilink for existing rows.", section: "Discography & Releases" },
    { name: "releases.categories.backfill [limit] [retry-blanks]", description: "Backfill raw release category text for releases not yet scraped, optionally retrying previously blank results.", section: "Discography & Releases" },
    { name: "releases.categories.missing.label <label_name> [output_file]", description: "Report albums on a given label that are missing the expected '<Label> albums' category.", section: "Discography & Releases" },
    { name: "releases.categories.missing.producer <producer_name> [output_file]", description: "Report albums by a given producer that are missing the expected 'Albums produced by <Producer>' category.", section: "Discography & Releases" },
    { name: "releases.categories.missing.label.all.linked [limit]", description: "Find unique linked label names from release data and run missing-label-category reports for each.", section: "Discography & Releases" },
    { name: "releases.categories.missing.label.cleanup.empty [dir]", description: "Delete missing-label-category report files with zero missing entries (defaults to tmp).", section: "Discography & Releases" },
    { name: "releases.labels.backfill [limit] [retry-blanks]", description: "Backfill normalized and raw release label data for releases not yet scraped, optionally retrying previously blank results.", section: "Discography & Releases" },
    { name: "releases.producers.backfill [limit] [retry-blanks]", description: "Backfill release producer data for releases not yet scraped, optionally retrying previously blank results.", section: "Discography & Releases" },
    { name: "releases.review.override <album_wikilink> <review_count|clear>", description: "Set or clear a manual review-count override for one release.", section: "Discography & Releases" },
    { name: "labels [limit]", description: "Run label scraping from the record-label index (0–9) and follow linked label pages.", section: "Labels" },
    { name: "yearly.albums.sync [year] [fresh]", description: "Sync yearly album references (optionally for a specific year). Add 'fresh' to clear release content hashes for that year first.", section: "Yearly Albums" },
    { name: "yearly.albums.missing <year> [full] [fresh|no-sync]", description: "List releases in a year missing from yearly album references. Add 'fresh' to clear release content hashes before syncing, or 'no-sync' to use database state only.", section: "Yearly Albums" },
    { name: "yearly.albums.needs_review.mark <year> <album_wikilink>", description: "Mark one yearly album reference as needs review.", section: "Yearly Albums" },
    { name: "yearly.albums.needs_review.list [year]", description: "List yearly album references marked needs review.", section: "Yearly Albums" },
    { name: "yearly.albums.unlinked <year>", description: "Find unlinked album rows on yearly list pages and suggest links.", section: "Yearly Albums" },
    { name: "yearly.albums.cited.reviews <year> [min_reviews]", description: "List albums that have a Ref citation on yearly list page(s) and at least min reviews in releases (default 3).", section: "Yearly Albums" },
];

if (args.length > 4) {
    console.log("too many arguments");
}

function printHelp(): void {
    console.log("Available commands:");
    const sectionOrder: string[] = [];
    const bySection = new Map<string, CommandHelp[]>();

    for (const command of COMMAND_HELP) {
        const sectionCommands = bySection.get(command.section);
        if (sectionCommands) {
            sectionCommands.push(command);
            continue;
        }
        sectionOrder.push(command.section);
        bySection.set(command.section, [command]);
    }

    for (const section of sectionOrder) {
        console.log("");
        console.log(`${section}:`);
        const commands = bySection.get(section) || [];
        for (const command of commands) {
            console.log(`- ${command.name}: ${command.description}`);
        }
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
        case 'artists.years_active.backfill': {
            const { artistsYearsActiveBackfill } = await import("./app/artists/query/yearsactivebackfill");
            await artistsYearsActiveBackfill();
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
        case 'artists.active.current_year.albums.sync': {
            const { artistsActiveCurrentYearAlbumSync } = await import("./app/artists/query/activecurrentyearalbumsync");
            await artistsActiveCurrentYearAlbumSync(args[1], args[2]);
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
        case 'releases.artist_id.backfill': {
            const { releasesBackfillArtistIds } = await import("./app/discography/query/backfillartistids");
            await releasesBackfillArtistIds();
            return;
        }
        case 'releases.categories.backfill': {
            const { releasesBackfillCategories } = await import("./app/discography/query/backfillcategories");
            await releasesBackfillCategories(args[1], args[2]);
            return;
        }
        case 'releases.categories.missing.label': {
            const { releasesMissingLabelCategory } = await import("./app/discography/query/missinglabelcategory");
            await releasesMissingLabelCategory(args[1], args[2]);
            return;
        }
        case 'releases.categories.missing.producer': {
            const { releasesMissingProducerCategory } = await import("./app/discography/query/missingproducercategory");
            await releasesMissingProducerCategory(args[1], args[2]);
            return;
        }
        case 'releases.categories.missing.label.all.linked': {
            const { releasesMissingLabelCategoryAllLinked } = await import("./app/discography/query/missinglabelcategoryall");
            await releasesMissingLabelCategoryAllLinked(args[1]);
            return;
        }
        case 'releases.categories.missing.label.cleanup.empty': {
            const { releasesMissingLabelCategoryCleanupEmpty } = await import("./app/discography/query/cleanupmissinglabelreports");
            await releasesMissingLabelCategoryCleanupEmpty(args[1]);
            return;
        }
        case 'releases.labels.backfill': {
            const { releasesBackfillLabels } = await import("./app/discography/query/backfilllabels");
            await releasesBackfillLabels(args[1], args[2]);
            return;
        }
        case 'releases.producers.backfill': {
            const { releasesBackfillProducers } = await import("./app/discography/query/backfillproducers");
            await releasesBackfillProducers(args[1], args[2]);
            return;
        }
        case 'releases.review.override': {
            const { discographyReviewOverride } = await import("./app/discography/query/reviewoverride");
            await discographyReviewOverride(args[1], args[2]);
            return;
        }
        case 'labels': {
            const { scrape } = await import("./app/labels/scrape");
            await scrape(args[1]);
            return;
        }
        case 'yearly.albums.sync': {
            const { syncYearlyAlbumReferences } = await import("./app/yearlyalbums/sync");
            await syncYearlyAlbumReferences(args[1], args[2]);
            return;
        }
        case 'yearly.albums.missing': {
            const { yearlyAlbumsMissingFromReference } = await import("./app/yearlyalbums/query/missingfromreference");
            await yearlyAlbumsMissingFromReference(args[1], args[2], args[3], args[4]);
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
