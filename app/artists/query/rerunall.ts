import artists from "app/repositories/artists/artists";

export async function artistsRerunAll(): Promise<void> {
    await artists.resetAllFoundPeers();
    console.log("Reset found_peers to false for all artists.");
}
