import discography from "app/repositories/discography/discography";

export async function releasesBackfillArtistIds(): Promise<void> {
    const updated = await discography.backfillArtistIds();
    console.log(`[releases.artist_id.backfill] updated=${updated}`);
}
