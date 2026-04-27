import discography from "app/repositories/discography/discography";
import {releasesMissingLabelCategory} from "app/discography/query/missinglabelcategory";

export async function releasesMissingLabelCategoryAllLinked(limitArg?: string): Promise<void> {
    let limit: number | null = null;
    if ((limitArg || "").trim().length > 0) {
        const parsed = parseInt(limitArg as string, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
            console.log(`[releases.categories.missing.label.all.linked] invalid limit "${limitArg}"`);
            console.log("[releases.categories.missing.label.all.linked] example: releases.categories.missing.label.all.linked 50");
            return;
        }
        limit = parsed;
    }

    const labels = await discography.getUniqueLinkedLabels();
    const canonicalLabels = collapseRecordLabelAliases(labels);
    const selected = limit ? canonicalLabels.slice(0, limit) : canonicalLabels;

    console.log(
        `[releases.categories.missing.label.all.linked] labels_found=${labels.length} canonical_labels=${canonicalLabels.length} running=${selected.length}${limit ? ` limit=${limit}` : ""}`,
    );

    for (let index = 0; index < selected.length; index++) {
        const label = selected[index];
        console.log(`[releases.categories.missing.label.all.linked] ${index + 1}/${selected.length} label="${label}"`);
        await releasesMissingLabelCategory(label);
    }

    console.log("[releases.categories.missing.label.all.linked] complete");
}

function collapseRecordLabelAliases(labels: string[]): string[] {
    const byLower = new Map<string, string>();
    for (const label of labels) {
        const normalized = (label || "").trim();
        if (!normalized) {
            continue;
        }
        byLower.set(normalized.toLowerCase(), normalized);
    }

    const result = new Set<string>();
    for (const label of labels) {
        const normalized = (label || "").trim();
        if (!normalized) {
            continue;
        }

        const recordsVariant = `${normalized} Records`;
        const recordsVariantMatch = byLower.get(recordsVariant.toLowerCase());
        if (recordsVariantMatch) {
            result.add(recordsVariantMatch);
            continue;
        }

        result.add(normalized);
    }

    return [...result].sort((a, b) => a.localeCompare(b));
}
