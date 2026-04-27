import artists from "app/repositories/artists/artists";
import {getHtml} from "app/clients/wikipedia";
import {extractYearsActiveFromHtml} from "app/artists/yearsactive";

export async function artistsYearsActiveBackfill(): Promise<void> {
    console.log("[artists.years_active.backfill] resetting years_active_scraped=false for all artists...");
    await artists.resetAllYearsActiveScraped();

    let processed = 0;
    let withYears = 0;
    let withoutYears = 0;
    let errors = 0;

    while (true) {
        const artist = await artists.getNextWhereYearsActiveNotScraped();
        if (!artist) {
            break;
        }

        try {
            const html = await getHtml(artist.wikilink);
            const years = extractYearsActiveFromHtml(html);
            await artists.updateYearsActive(artist.wikilink, years.yearStart, years.yearEnd);
            await artists.markYearsActiveScraped(artist.wikilink);
            processed += 1;
            if (years.yearStart !== null) {
                withYears += 1;
            } else {
                withoutYears += 1;
            }

            if (processed % 100 === 0) {
                console.log(
                    `[artists.years_active.backfill] progress processed=${processed} with_years=${withYears} without_years=${withoutYears} errors=${errors}`,
                );
            }
        } catch (e) {
            errors += 1;
            await artists.markYearsActiveScraped(artist.wikilink);
            const message = e instanceof Error ? e.message : String(e);
            console.log(`[artists.years_active.backfill] error url=${artist.wikilink} message=${message}`);
        }
    }

    console.log(
        `[artists.years_active.backfill] complete processed=${processed} with_years=${withYears} without_years=${withoutYears} errors=${errors}`,
    );
}
