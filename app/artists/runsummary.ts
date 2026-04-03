type NewArtist = {
    name: string;
    link: string;
};

type ContentHashSkip = {
    link: string;
};

const runSummary = {
    deadlinksAdded: 0,
    newArtists: [] as NewArtist[],
    contentHashSkips: [] as ContentHashSkip[],
};

export function recordDeadlinkAdded(): void {
    runSummary.deadlinksAdded += 1;
}

export function recordNewArtist(name: string, link: string): void {
    runSummary.newArtists.push({ name, link });
}

export function recordContentHashSkip(link: string): void {
    runSummary.contentHashSkips.push({ link });
}

export function printRunSummary(): void {
    console.log("Run summary:");
    console.log(`Deadlinks added: ${runSummary.deadlinksAdded}`);
    console.log(`New artists added: ${runSummary.newArtists.length}`);
    console.log(`Skipped (content hash unchanged): ${runSummary.contentHashSkips.length}`);

    if (runSummary.newArtists.length === 0) {
        console.log("No new artists added.");
    } else {
        console.log("New artists:");
        for (const artist of runSummary.newArtists) {
            console.log(`- ${artist.name}: ${artist.link}`);
        }
    }

    if (runSummary.contentHashSkips.length > 0) {
        console.log("Content-hash skips:");
        for (const item of runSummary.contentHashSkips.slice(0, 25)) {
            console.log(`- ${item.link}`);
        }
        if (runSummary.contentHashSkips.length > 25) {
            console.log(`...and ${runSummary.contentHashSkips.length - 25} more`);
        }
    }
}
