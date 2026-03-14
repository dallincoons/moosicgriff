import artists from "app/repositories/artists/artists";

export async function artistsRerunAll(): Promise<void> {
    await artists.resetAllFoundPeers();
    console.log("Reset complete.");
}
