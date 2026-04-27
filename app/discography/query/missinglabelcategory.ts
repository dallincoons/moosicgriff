import * as fs from "fs";
import discography from "app/repositories/discography/discography";
import {DBRelease} from "app/discography/release";
import {getAlbumReleaseFromApi} from "app/clients/wikipediaapi";

type MissingCategoryRow = {
    artistName: string;
    albumTitle: string;
    albumWikilink: string;
    year: number | null;
    labels: string;
    categories: string;
};

export async function releasesMissingLabelCategory(labelArg?: string, outputFileArg?: string): Promise<void> {
    const label = (labelArg || "").trim();
    if (!label) {
        console.log("[releases.categories.missing.label] missing label argument");
        console.log('[releases.categories.missing.label] example: releases.categories.missing.label "Capitol Records" tmp/capitol_missing_categories.txt');
        return;
    }

    const expectedCategory = `${label} albums`;
    const acceptedCategories = buildAcceptedLabelCategories(label);
    const outputFile = (outputFileArg || "").trim() || defaultOutputPath(label);
    const releases = await discography.getReleasesLikelyOnLabel(label);
    const exactLabelMatches = releases.filter((release) => hasLabelMatch(release, label));
    const provisionalMissing = exactLabelMatches.filter((release) => !hasCategory(release.original_categories_text, expectedCategory));
    const {
        confirmedMissing,
        refreshedFromApi,
        excludedByAcceptedVariantCategory,
    } = await confirmMissingCategories(
        provisionalMissing,
        acceptedCategories,
    );

    const reportRows = confirmedMissing.map((release) => ({
        artistName: release.artist_name,
        albumTitle: release.original_title || release.title,
        albumWikilink: release.wikilink,
        year: release.dateyear,
        labels: release.label || release.original_labels_text || "",
        categories: release.original_categories_text || "",
    }));

    console.log(`[releases.categories.missing.label] label="${label}" expected_category="${expectedCategory}"`);
    console.log(
        `[releases.categories.missing.label] candidates=${releases.length} exact_label_matches=${exactLabelMatches.length} provisional_missing=${provisionalMissing.length} missing_category=${confirmedMissing.length} refreshed_from_api=${refreshedFromApi} excluded_by_variant_category=${excludedByAcceptedVariantCategory}`,
    );

    if (reportRows.length === 0) {
        if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
            console.log(`[releases.categories.missing.label] report_deleted_empty=${outputFile}`);
        } else {
            console.log("[releases.categories.missing.label] report_skipped_empty=true");
        }
        return;
    }

    const report = formatReport(label, expectedCategory, releases.length, exactLabelMatches.length, reportRows);
    fs.writeFileSync(outputFile, report, "utf8");
    console.log(`[releases.categories.missing.label] report_written=${outputFile}`);
}

async function confirmMissingCategories(
    releases: DBRelease[],
    acceptedCategories: string[],
): Promise<{
    confirmedMissing: DBRelease[];
    refreshedFromApi: number;
    excludedByAcceptedVariantCategory: number;
}> {
    const confirmedMissing: DBRelease[] = [];
    let refreshedFromApi = 0;
    let excludedByAcceptedVariantCategory = 0;

    for (const release of releases) {
        let effectiveCategories = release.original_categories_text || "";
        const releaseAcceptedCategories = buildReleaseAcceptedCategories(release, acceptedCategories);

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

        if (hasAnyCategory(effectiveCategories, releaseAcceptedCategories)) {
            excludedByAcceptedVariantCategory += 1;
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
        excludedByAcceptedVariantCategory,
    };
}

function hasLabelMatch(release: DBRelease, label: string): boolean {
    const normalizedTarget = normalizeToken(label);
    const canonicalTarget = canonicalizeRecordLabelToken(normalizedTarget);
    if (!normalizedTarget) {
        return false;
    }

    const originalTokens = tokenizeLabels(release.original_labels_text || "");
    if (originalTokens.length > 0) {
        const first = originalTokens[0];
        const canonicalFirst = canonicalizeRecordLabelToken(first);
        return first === normalizedTarget || canonicalFirst === canonicalTarget;
    }

    const normalizedTokens = tokenizeLabels(release.label || "");
    if (normalizedTokens.length === 0) {
        return false;
    }

    const first = normalizedTokens[0];
    const canonicalFirst = canonicalizeRecordLabelToken(first);
    return first === normalizedTarget || canonicalFirst === canonicalTarget;
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

function hasAnyCategory(rawCategories: string | null | undefined, acceptedCategories: string[]): boolean {
    for (const category of acceptedCategories) {
        if (hasCategory(rawCategories, category)) {
            return true;
        }
    }
    return false;
}

function buildReleaseAcceptedCategories(release: DBRelease, baseAcceptedCategories: string[]): string[] {
    const categories = new Set<string>(baseAcceptedCategories);
    const aliases = getFirstLabelAliasCandidates(release.original_labels_text || "");

    for (const alias of aliases) {
        for (const category of buildAcceptedLabelCategories(alias)) {
            categories.add(category);
        }
    }

    return [...categories];
}

function getFirstLabelAliasCandidates(rawLabelText: string): string[] {
    const firstSegment = firstLabelSegment(rawLabelText);
    if (!firstSegment) {
        return [];
    }

    const wikilinkMatch = firstSegment.match(/\[\[([^|\]]+)(?:\|([^\]]+))?]]/);
    if (!wikilinkMatch) {
        return [];
    }

    const target = normalizeToken(wikilinkMatch[1] || "");
    const display = normalizeDisplayToken(wikilinkMatch[2] || "");

    if (!target || !display) {
        return [];
    }

    // Treat as alias only when display is materially different from target,
    // e.g., [[Reprise Records|Vapor]].
    if (stripRecordsSuffix(target) === stripRecordsSuffix(display)) {
        return [];
    }

    return [restoreTokenCase(wikilinkMatch[2] || "")];
}

function firstLabelSegment(rawLabelText: string): string {
    const normalizedListText = rawLabelText
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/^\s*[\*\-]\s*/gm, "")
        .replace(/\r/g, "");

    const segments = normalizedListText
        .split(/,|;|\/|\n+/i)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

    return segments[0] || "";
}

function tokenizeLabels(rawLabelText: string): string[] {
    const normalizedListText = rawLabelText
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/^\s*[\*\-]\s*/gm, "")
        .replace(/\r/g, "");

    return normalizedListText
        .split(/,|;|\/|\n+/i)
        .map((part) => normalizeToken(part))
        .filter((part) => part.length > 0);
}

function normalizeToken(value: string): string {
    return (value || "")
        // Prefer wikilink target over display text: [[Barsuk Records|Barsuk]] -> Barsuk Records
        .replace(/\[\[([^|\]]+)(?:\|[^\]]+)?]]/g, "$1")
        .replace(/''+/g, "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function normalizeDisplayToken(value: string): string {
    return (value || "")
        .replace(/\[\[([^|\]]+)(?:\|([^\]]+))?]]/g, "$2")
        .replace(/''+/g, "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function canonicalizeRecordLabelToken(token: string): string {
    const normalized = (token || "").trim().toLowerCase();
    if (!normalized) {
        return normalized;
    }
    if (normalized.endsWith(" records")) {
        return normalized;
    }
    return `${normalized} records`;
}

function stripRecordsSuffix(token: string): string {
    return (token || "").replace(/\s+records$/i, "").trim().toLowerCase();
}

function defaultOutputPath(label: string): string {
    const slug = label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return `tmp/${slug || "label"}_missing_category_albums.txt`;
}

function buildAcceptedLabelCategories(label: string): string[] {
    const forms = getLabelForms(label);
    const categories = new Set<string>();

    for (const form of forms) {
        categories.add(`${form} albums`);
        categories.add(`${form} compilation albums`);
        categories.add(`${form} EPs`);
        categories.add(`${form} live albums`);
        categories.add(`${form} remix albums`);
        categories.add(`${form} soundtracks`);
        categories.add(`${form} video albums`);
    }

    return [...categories];
}

function getLabelForms(label: string): string[] {
    const trimmed = (label || "").trim();
    if (!trimmed) {
        return [];
    }

    const forms = new Set<string>();
    forms.add(trimmed);

    const lower = trimmed.toLowerCase();
    if (lower.endsWith(" records")) {
        forms.add(trimmed.replace(/\s+records$/i, "").trim());
    } else {
        forms.add(`${trimmed} Records`);
    }

    return [...forms].filter((value) => value.length > 0);
}

function restoreTokenCase(value: string): string {
    return (value || "")
        .replace(/''+/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function formatReport(
    label: string,
    expectedCategory: string,
    scannedCandidates: number,
    exactLabelMatches: number,
    rows: MissingCategoryRow[],
): string {
    const lines: string[] = [];
    lines.push("=== Releases Missing Label Category ===");
    lines.push(`Label: ${label}`);
    lines.push(`Expected Category: ${expectedCategory}`);
    lines.push(`Likely Candidates Scanned: ${scannedCandidates}`);
    lines.push(`Exact Label Matches: ${exactLabelMatches}`);
    lines.push(`Missing Category Count: ${rows.length}`);
    lines.push("");

    for (const row of rows) {
        lines.push(`Artist: ${row.artistName}`);
        lines.push(`Album: ${row.albumTitle}`);
        lines.push(`Year: ${row.year ?? "(unknown)"}`);
        lines.push(`Wikilink: ${row.albumWikilink}`);
        lines.push(`Labels: ${row.labels || "(blank)"}`);
        lines.push(`Categories: ${row.categories || "(blank)"}`);
        lines.push("");
    }

    return `${lines.join("\n")}\n`;
}
