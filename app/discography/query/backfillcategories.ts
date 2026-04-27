import {getAlbumReleaseFromApi} from "app/clients/wikipediaapi";
import discography from "app/repositories/discography/discography";

export async function releasesBackfillCategories(arg1?: string, arg2?: string): Promise<void> {
    const {limit, retryBlanks, invalidArg} = parseArgs(arg1, arg2);
    if (invalidArg) {
        console.log(`[releases.categories.backfill] invalid argument "${invalidArg}"`);
        return;
    }

    const pending = await discography.getReleasesPendingCategoryBackfill(limit ?? undefined, retryBlanks);
    console.log(
        `[releases.categories.backfill] pending=${pending.length}${limit ? ` limit=${limit}` : ""}${retryBlanks ? " retry_blanks=true" : ""}`,
    );

    if (pending.length === 0) {
        return;
    }

    let updated = 0;
    let blank = 0;
    let failed = 0;

    for (let index = 0; index < pending.length; index++) {
        const release = pending[index];
        const prefix = `[releases.categories.backfill] ${index + 1}/${pending.length}`;
        console.log(`${prefix} ${release.artist_name} - ${release.original_title || release.title}`);

        try {
            const hydrated = await getAlbumReleaseFromApi(release.wikilink);
            if (!hydrated) {
                failed += 1;
                console.log(`${prefix} status=failed reason=not_album_or_missing_page`);
                continue;
            }

            const originalCategoriesText = (hydrated.original_categories_text || "").trim();
            await discography.saveReleaseCategoriesById(release.id, originalCategoriesText);
            updated += 1;

            if (!originalCategoriesText) {
                blank += 1;
                console.log(`${prefix} status=saved categories=(blank)`);
            } else {
                console.log(`${prefix} status=saved categories=${originalCategoriesText}`);
            }
        } catch (e) {
            failed += 1;
            const message = e instanceof Error ? e.message : String(e);
            console.log(`${prefix} status=failed error=${message}`);
        }
    }

    console.log(
        `[releases.categories.backfill] complete updated=${updated} blank=${blank} failed=${failed}`,
    );
}

function parseArgs(arg1?: string, arg2?: string): { limit: number | null; retryBlanks: boolean; invalidArg?: string } {
    let limit: number | null = null;
    let retryBlanks = false;

    for (const value of [arg1, arg2]) {
        if (!value) {
            continue;
        }

        const normalized = value.trim().toLowerCase();
        if (normalized === "retry-blanks" || normalized === "retry_blanks") {
            retryBlanks = true;
            continue;
        }

        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
            return {limit: null, retryBlanks, invalidArg: value};
        }

        limit = parsed;
    }

    return {limit, retryBlanks};
}
