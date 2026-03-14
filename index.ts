const args = process.argv.slice(2);

if (args.length > 2) {
    console.log("you can't give more than two arguments, dumb shit");
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
            const { artistsRerunAll } = await import("./app/artists/query/rerunall");
            await artistsRerunAll();
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
        case 'labels': {
            const { scrape } = await import("./app/labels/scrape");
            await scrape();
            return;
        }
        default:
            console.log("command not recognized");
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            const { closeArtistScrapeResources } = await import("./app/artists/scrape");
            closeArtistScrapeResources();
        } catch (e) {
        }

        try {
            const { closeDb } = await import("./app/repositories/db");
            await closeDb();
        } catch (e) {
        }
    });
