import * as cheerio from "cheerio";

export function extractYearsActiveFromHtml(html: string): { yearStart: number | null; yearEnd: number | null } {
    const $ = cheerio.load(html);
    const row = $("table.infobox tr").filter((_, el) => {
        const header = $(el).children("th").first().text().trim().toLowerCase().replace(/\s+/g, " ");
        return header === "years active" || header === "years_active";
    }).first();

    if (!row.length) {
        return { yearStart: null, yearEnd: null };
    }

    const cell = row.children("td").first();
    const yearsText = normalizeYearsActiveText(cell.text());
    if (!yearsText) {
        return { yearStart: null, yearEnd: null };
    }

    const ranges = parseActiveYearRanges(yearsText);
    if (ranges.length === 0) {
        return { yearStart: null, yearEnd: null };
    }

    const yearStart = Math.min(...ranges.map((range) => range.start));
    const isStillActive = ranges.some((range) => range.end === null);
    if (isStillActive) {
        return { yearStart, yearEnd: null };
    }

    const endedYears = ranges
        .map((range) => range.end)
        .filter((value): value is number => typeof value === "number");
    const yearEnd = endedYears.length > 0 ? Math.max(...endedYears) : null;
    return { yearStart, yearEnd };
}

function normalizeYearsActiveText(value: string): string {
    return (value || "")
        .replace(/\[[0-9]+\]/g, " ")
        .replace(/\u2013/g, "-")
        .replace(/\u2014/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

function parseActiveYearRanges(value: string): Array<{ start: number; end: number | null }> {
    const ranges: Array<{ start: number; end: number | null }> = [];
    const rangeRegex = /\b(19|20)\d{2}\b\s*(?:-|to)\s*(present|\b(19|20)\d{2}\b)/gi;
    let match: RegExpExecArray | null;

    while ((match = rangeRegex.exec(value)) !== null) {
        const start = parseInt(match[0].match(/\b(19|20)\d{2}\b/)?.[0] || "", 10);
        if (Number.isNaN(start)) {
            continue;
        }

        const rightSide = (match[2] || "").toLowerCase();
        if (rightSide === "present") {
            ranges.push({ start, end: null });
            continue;
        }

        const end = parseInt(rightSide, 10);
        if (Number.isNaN(end)) {
            ranges.push({ start, end: null });
            continue;
        }
        ranges.push({ start, end });
    }

    return ranges;
}
