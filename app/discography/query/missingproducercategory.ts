import * as fs from "fs";
import discography from "app/repositories/discography/discography";
import {DBRelease} from "app/discography/release";
import {getAlbumReleaseFromApi} from "app/clients/wikipediaapi";

type MissingProducerCategoryRow = {
    artistName: string;
    albumTitle: string;
    albumWikilink: string;
    year: number | null;
    producers: string;
    categories: string;
};

export async function releasesMissingProducerCategory(producerArg?: string, outputFileArg?: string): Promise<void> {
    const producer = (producerArg || "").trim();
    const likelyUnquotedProducer = isLikelyUnquotedProducerInput(producerArg, outputFileArg);
    if (likelyUnquotedProducer) {
        const combined = `${(producerArg || "").trim()} ${(outputFileArg || "").trim()}`.trim();
        console.log(`[releases.categories.missing.producer] ambiguous arguments detected.`);
        console.log(`[releases.categories.missing.producer] You probably meant producer="${combined}" (quoted).`);
        console.log(
            `[releases.categories.missing.producer] example: releases.categories.missing.producer "${combined}" tmp/${toSlug(combined)}_missing_producer_category_albums.txt`,
        );
        return;
    }

    if (!producer) {
        console.log("[releases.categories.missing.producer] missing producer argument");
        console.log(
            '[releases.categories.missing.producer] example: releases.categories.missing.producer "Trevor Horn" tmp/trevor_horn_missing_producer_categories.txt',
        );
        return;
    }

    const expectedCategory = `Albums produced by ${producer}`;
    const outputFile = (outputFileArg || "").trim() || defaultOutputPath(producer);
    const releases = await discography.getReleasesLikelyByProducer(producer);
    const exactProducerMatches = releases.filter((release) => hasProducerMatch(release, producer));
    const provisionalMissing = exactProducerMatches.filter((release) => !hasCategory(release.original_categories_text, expectedCategory));
    const {
        confirmedMissing,
        refreshedFromApi,
    } = await confirmMissingCategories(
        provisionalMissing,
        expectedCategory,
    );

    const reportRows = confirmedMissing.map((release) => ({
        artistName: release.artist_name,
        albumTitle: release.original_title || release.title,
        albumWikilink: release.wikilink,
        year: release.dateyear,
        producers: release.producer || "",
        categories: release.original_categories_text || "",
    }));

    console.log(`[releases.categories.missing.producer] producer="${producer}" expected_category="${expectedCategory}"`);
    console.log(
        `[releases.categories.missing.producer] candidates=${releases.length} exact_producer_matches=${exactProducerMatches.length} provisional_missing=${provisionalMissing.length} missing_category=${confirmedMissing.length} refreshed_from_api=${refreshedFromApi}`,
    );

    if (reportRows.length === 0) {
        if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
            console.log(`[releases.categories.missing.producer] report_deleted_empty=${outputFile}`);
        } else {
            console.log("[releases.categories.missing.producer] report_skipped_empty=true");
        }
        return;
    }

    const report = formatReport(producer, expectedCategory, releases.length, exactProducerMatches.length, reportRows);
    fs.writeFileSync(outputFile, report, "utf8");
    console.log(`[releases.categories.missing.producer] report_written=${outputFile}`);
}

async function confirmMissingCategories(
    releases: DBRelease[],
    expectedCategory: string,
): Promise<{
    confirmedMissing: DBRelease[];
    refreshedFromApi: number;
}> {
    const confirmedMissing: DBRelease[] = [];
    let refreshedFromApi = 0;

    for (const release of releases) {
        let effectiveCategories = release.original_categories_text || "";

        try {
            const hydrated = await getAlbumReleaseFromApi(release.wikilink);
            const fetchedCategories = (hydrated?.original_categories_text || "").trim();
            if (fetchedCategories) {
                effectiveCategories = fetchedCategories;
                refreshedFromApi += 1;
                await discography.saveReleaseCategoriesById(release.id, fetchedCategories);
            }
        } catch (e) {
        }

        if (hasCategory(effectiveCategories, expectedCategory)) {
            continue;
        }

        confirmedMissing.push({
            ...release,
            original_categories_text: effectiveCategories,
        });
    }

    return {
        confirmedMissing,
        refreshedFromApi,
    };
}

function hasProducerMatch(release: DBRelease, producer: string): boolean {
    const normalizedTarget = normalizeToken(producer);
    if (!normalizedTarget) {
        return false;
    }

    const tokens = tokenizeProducers(release.producer || "");
    return tokens.includes(normalizedTarget);
}

function tokenizeProducers(rawProducerText: string): string[] {
    const normalizedListText = rawProducerText
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/^\s*[\*\-]\s*/gm, "")
        .replace(/\r/g, "");

    return normalizedListText
        .split(/,|;|\/|\n+|\sand\s/gi)
        .map((part) => normalizeToken(part))
        .filter((part) => part.length > 0);
}

function hasCategory(rawCategories: string | null | undefined, expectedCategory: string): boolean {
    const normalizedExpected = normalizeToken(expectedCategory);
    if (!normalizedExpected) {
        return false;
    }

    const tokens = (rawCategories || "")
        .split(",")
        .map((part) => normalizeToken(part))
        .filter((part) => part.length > 0);

    return tokens.includes(normalizedExpected);
}

function normalizeToken(value: string): string {
    return (value || "")
        .replace(/\[\[([^|\]]+)(?:\|[^\]]+)?]]/g, "$1")
        .replace(/''+/g, "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function defaultOutputPath(producer: string): string {
    const slug = toSlug(producer);
    return `tmp/${slug || "producer"}_missing_producer_category_albums.txt`;
}

function toSlug(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function isLikelyUnquotedProducerInput(producerArg?: string, outputFileArg?: string): boolean {
    const first = (producerArg || "").trim();
    const second = (outputFileArg || "").trim();
    if (!first || !second) {
        return false;
    }

    // If second arg looks like an explicit path/file, treat it as output file.
    if (/[\\/]/.test(second) || /\.[a-z0-9]+$/i.test(second)) {
        return false;
    }

    // If second arg resembles a producer name token, this is most likely an unquoted multi-word producer.
    return /^[a-z][a-z0-9'._-]*$/i.test(first) && /^[a-z][a-z0-9'._-]*$/i.test(second);
}

function formatReport(
    producer: string,
    expectedCategory: string,
    scannedCandidates: number,
    exactProducerMatches: number,
    rows: MissingProducerCategoryRow[],
): string {
    const lines: string[] = [];
    lines.push("=== Releases Missing Producer Category ===");
    lines.push(`Producer: ${producer}`);
    lines.push(`Expected Category: ${expectedCategory}`);
    lines.push(`Likely Candidates Scanned: ${scannedCandidates}`);
    lines.push(`Exact Producer Matches: ${exactProducerMatches}`);
    lines.push(`Missing Category Count: ${rows.length}`);
    lines.push("");

    for (const row of rows) {
        lines.push(`Artist: ${row.artistName}`);
        lines.push(`Album: ${row.albumTitle}`);
        lines.push(`Year: ${row.year ?? "(unknown)"}`);
        lines.push(`Wikilink: ${row.albumWikilink}`);
        lines.push(`Producers: ${row.producers || "(blank)"}`);
        lines.push(`Categories: ${row.categories || "(blank)"}`);
        lines.push("");
    }

    return `${lines.join("\n")}\n`;
}
