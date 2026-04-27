import discography from "app/repositories/discography/discography";

export async function discographyReviewOverride(releaseWikilinkArg?: string, manualCountArg?: string): Promise<void> {
    const releaseWikilink = (releaseWikilinkArg || "").trim();
    if (!releaseWikilink) {
        console.log("[releases.review.override] missing album_wikilink argument");
        return;
    }

    const manualCount = parseManualCount(manualCountArg);
    if (manualCountArg === undefined || manualCount === undefined) {
        console.log('[releases.review.override] invalid review_count. expected integer >= 0, or "clear"');
        return;
    }

    const storedValue = manualCount === "clear" ? null : manualCount;
    const updated = await discography.setManualReviewCount(releaseWikilink, storedValue);
    console.log(
        `[releases.review.override] album=${releaseWikilink} manual_reviews=${storedValue === null ? "null" : storedValue} updated=${updated}`,
    );
}

function parseManualCount(value?: string): number | "clear" | undefined {
    if (value === undefined) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "clear" || normalized === "null") {
        return "clear";
    }

    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
        return undefined;
    }

    return parsed;
}
