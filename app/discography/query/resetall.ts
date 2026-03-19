import artists from "app/repositories/artists/artists";

export async function discographyResetAll(): Promise<void> {
    await artists.resetAllFoundDiscography();
    console.log("Reset complete.");
}
