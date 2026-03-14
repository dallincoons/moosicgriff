type NewArtist = {
    name: string;
    link: string;
};

const runSummary = {
    deadlinksAdded: 0,
    newArtists: [] as NewArtist[],
};

export function recordDeadlinkAdded(): void {
    runSummary.deadlinksAdded += 1;
}

export function recordNewArtist(name: string, link: string): void {
    runSummary.newArtists.push({ name, link });
}

export function printRunSummary(): void {
    console.log("Run summary:");
    console.log(`Deadlinks added: ${runSummary.deadlinksAdded}`);
    console.log(`New artists added: ${runSummary.newArtists.length}`);

    if (runSummary.newArtists.length === 0) {
        console.log("No new artists added.");
        return;
    }

    console.log("New artists:");
    for (const artist of runSummary.newArtists) {
        console.log(`- ${artist.name}: ${artist.link}`);
    }
}
