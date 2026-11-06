import {db} from "app/repositories/db";
import {DBLabel, Label} from "app/labels/label";

class Labels {
    async upsertLabel(label: Label): Promise<void> {
        await db`
            insert into labels
                (
                    wikilink,
                    wikipedia_page_id,
                    name,
                    founded,
                    country_of_origin,
                    genre,
                    founder,
                    last_scraped_at
                ) values (
                    ${label.wikilink}::text,
                    ${label.wikipedia_page_id ?? null}::bigint,
                    ${label.name}::text,
                    ${label.founded}::text,
                    ${label.country_of_origin}::text,
                    ${label.genre}::text,
                    ${label.founder}::text,
                    CURRENT_TIMESTAMP
                )
            on conflict (wikilink)
            do update
            set
                wikipedia_page_id = excluded.wikipedia_page_id,
                name = excluded.name,
                founded = excluded.founded,
                country_of_origin = excluded.country_of_origin,
                genre = excluded.genre,
                founder = excluded.founder,
                last_scraped_at = CURRENT_TIMESTAMP
        `;
    }

    async getAll(limit?: number): Promise<DBLabel[]> {
        return limit && limit > 0
            ? await db`
                select *
                from labels
                order by name asc
                limit ${limit}
            `
            : await db`
                select *
                from labels
                order by name asc
            `;
    }

    async getVerifiedLabels(): Promise<DBLabel[]> {
        return await db`
            select *
            from labels
            where wikipedia_page_id is not null
              and wikilink is not null
              and length(trim(wikilink)) > 0
            order by name asc
        `;
    }

    async findVerifiedLabelByName(labelName: string): Promise<DBLabel | null> {
        const normalized = normalizeLabelToken(labelName);
        if (!normalized) {
            return null;
        }

        const verified = await this.getVerifiedLabels();
        for (const label of verified) {
            if (normalizeLabelToken(label.name) === normalized) {
                return label;
            }
            if (canonicalizeLabelToken(label.name) === canonicalizeLabelToken(normalized)) {
                return label;
            }
        }

        return null;
    }
}

export default new Labels();

function normalizeLabelToken(value: string): string {
    return (value || "")
        .replace(/\[\[([^|\]]+)(?:\|[^\]]+)?]]/g, "$1")
        .replace(/''+/g, "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function canonicalizeLabelToken(value: string): string {
    const normalized = normalizeLabelToken(value);
    if (!normalized) {
        return normalized;
    }

    if (normalized.endsWith(" records")) {
        return normalized;
    }

    return `${normalized} records`;
}
