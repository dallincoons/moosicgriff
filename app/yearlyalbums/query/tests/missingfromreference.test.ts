import {parseDateCompletenessMode} from "app/yearlyalbums/query/missingmode";
import {yearlyAlbumsMissingFromReference} from "app/yearlyalbums/query/missingfromreference";
import {db} from "app/repositories/db";

jest.mock("app/repositories/db", () => ({db: jest.fn()}));

const mockDb = db as unknown as jest.Mock<Promise<unknown[]>, [TemplateStringsArray, ...unknown[]]>;

describe("yearlyAlbumsMissingFromReference mode parsing", () => {
    it("defaults to all when mode is omitted", () => {
        expect(parseDateCompletenessMode()).toBe("all");
    });

    it("accepts full mode", () => {
        expect(parseDateCompletenessMode("full")).toBe("full");
        expect(parseDateCompletenessMode(" FULL ")).toBe("full");
    });

    it("rejects unsupported modes", () => {
        expect(parseDateCompletenessMode("incomplete")).toBeNull();
        expect(parseDateCompletenessMode("all")).toBeNull();
        expect(parseDateCompletenessMode("whatever")).toBeNull();
    });
});

describe("yearlyAlbumsMissingFromReference source pages", () => {
    beforeEach(() => {
        mockDb.mockReset();
        mockDb.mockResolvedValue([]);
        jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([2021, 2026])("checks both halves of %i for existing and flagged references", async (year) => {
        await yearlyAlbumsMissingFromReference(String(year), "full", "no-sync");

        expect(db).toHaveBeenCalledTimes(1);
        const [sql, ...parameters] = mockDb.mock.calls[0];
        const pages = [
            `https://en.wikipedia.org/wiki/List_of_${year}_albums_(January%E2%80%93June)`,
            `https://en.wikipedia.org/wiki/List_of_${year}_albums_(July%E2%80%93December)`,
        ];
        for (const alias of ["yar", "yar_review"]) {
            const index = sql.findIndex((part) =>
                part.endsWith(`${alias}.source_list_wikilink = any(`),
            );
            expect(index).toBeGreaterThanOrEqual(0);
            expect(parameters[index]).toEqual(pages);
            expect(sql[index + 1]).toMatch(/^::text\[\]\)/);
        }
    });

    it("keeps a single source page for an unsplit year", async () => {
        await yearlyAlbumsMissingFromReference("2025", "full", "no-sync");

        const [, ...parameters] = mockDb.mock.calls[0];
        expect(parameters.filter(Array.isArray)).toEqual([
            ["https://en.wikipedia.org/wiki/List_of_2025_albums"],
            ["https://en.wikipedia.org/wiki/List_of_2025_albums"],
        ]);
    });
});
