export type DateCompletenessMode = "full" | "all";

export function parseDateCompletenessMode(modeArg?: string): DateCompletenessMode | null {
    if (!modeArg) {
        return "all";
    }
    const normalized = modeArg.trim().toLowerCase();
    if (normalized === "full") {
        return "full";
    }
    return null;
}
