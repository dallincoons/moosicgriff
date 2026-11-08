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
        const index = sql.findIndex((part) =>
            part.endsWith("yar.source_list_wikilink = any("),
        );
        expect(index).toBeGreaterThanOrEqual(0);
        expect(parameters[index]).toEqual(pages);
        expect(sql[index + 1]).toMatch(/^::text\[\]\)/);
    });

    it("keeps a single source page for an unsplit year", async () => {
        await yearlyAlbumsMissingFromReference("2025", "full", "no-sync");

        const [, ...parameters] = mockDb.mock.calls[0];
        expect(parameters.filter(Array.isArray)).toEqual([
            ["https://en.wikipedia.org/wiki/List_of_2025_albums"],
        ]);
    });
});

// Executes only SELECTs over inline fixture relations on a real Postgres connection.
// No production tables are changed, and no sync is run.
const integration = process.env.MISSING_QUERY_INTEGRATION === "1" ? describe : describe.skip;
integration("missing albums SQL matching", () => {
    let realDb: typeof db;
    let closeDb: () => Promise<void>;
    const source = "https://en.wikipedia.org/wiki/2003_in_music";
    const ref = (overrides: Record<string, unknown> = {}) => ({
        source_list_wikilink: source, wikipedia_page_id: 100,
        album_wikilink: "https://en.wikipedia.org/wiki/Listed", album_name: "Listed",
        needs_review: false, ...overrides,
    });
    const release = (overrides: Record<string, unknown> = {}) => ({
        artist_name: "Artist", title: "Missing", original_title: "Missing",
        wikilink: "https://en.wikipedia.org/wiki/Missing", wikipedia_page_id: 200,
        manual_number_of_reviews: null, number_of_reviews: 3,
        dateyear: 2003, datemonth: "August", dateday: 18,
        releasetype: "studio", original_releasetype: "studio", original_categories_text: "",
        ...overrides,
    });

    beforeAll(() => {
        ({db: realDb, closeDb} = jest.requireActual("app/repositories/db"));
    });
    afterAll(async () => { await closeDb(); });
    beforeEach(() => {
        mockDb.mockReset();
        jest.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    async function query(releases: unknown[], references: unknown[], mode?: string) {
        mockDb.mockImplementationOnce(async (parts, ...parameters) => {
            let statement = parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, "");
            const releaseParam = parameters.length + 1;
            const refParam = parameters.length + 2;
            statement = statement.replace("with source_references as materialized (", `with releases as (
                select * from jsonb_to_recordset($${releaseParam}::text::jsonb) as rows(
                    artist_name text, title text, original_title text, wikilink text,
                    wikipedia_page_id bigint, manual_number_of_reviews integer, number_of_reviews integer,
                    dateyear integer, datemonth text, dateday integer,
                    releasetype text, original_releasetype text, original_categories_text text
                )
            ), yearly_album_references as (
                select * from jsonb_to_recordset($${refParam}::text::jsonb) as rows(
                    source_list_wikilink text, wikipedia_page_id bigint,
                    album_wikilink text, album_name text, needs_review boolean
                )
            ), source_references as materialized (`);
            return await realDb.unsafe(statement, [...parameters, JSON.stringify(releases), JSON.stringify(references)] as never[]);
        });
        await yearlyAlbumsMissingFromReference("2003", mode, "no-sync");
        const result = await mockDb.mock.results[mockDb.mock.results.length - 1].value;
        return result as Array<{title: string; effective_number_of_reviews: number}>;
    }

    it.each([
        ["page ID", {wikipedia_page_id: 100}, {}],
        ["URL without a page ID", {wikipedia_page_id: null, wikilink: "https://en.wikipedia.org/wiki/Listed"}, {}],
        ["encoded URL without a page ID", {wikipedia_page_id: null, wikilink: "https://en.wikipedia.org/wiki/It%27s_%28Wild%29%2C_%26_Free%21"}, {album_wikilink: "https://en.wikipedia.org/wiki/It's_(Wild),_&_Free!"}],
        ["album link suffix", {wikilink: "https://en.wikipedia.org/wiki/Listed_(album)"}, {}],
        ["original title suffix", {original_title: "Listed (album)"}, {}],
        ["title suffix", {title: "LISTED (album)"}, {}],
        ["flagged URL with a different page ID", {wikilink: "https://en.wikipedia.org/wiki/It%27s_Wild"}, {needs_review: true, album_wikilink: "https://en.wikipedia.org/wiki/It's_Wild"}],
        ["flagged original title case", {original_title: "Listed (ALBUM)"}, {needs_review: true, album_name: "Listed (album)"}],
        ["flagged title case", {title: "Listed (ALBUM)"}, {needs_review: true, album_name: "Listed (album)"}],
        ["null titles", {title: null, original_title: null}, {album_name: ""}],
    ])("excludes matches by %s", async (_name, candidate, reference) => {
        expect(await query([release(candidate as Record<string, unknown>)], [ref(reference as Record<string, unknown>)], "full")).toEqual([]);
    });

    it("keeps unrelated releases, other-year references, and non-flagged URL aliases with different IDs", async () => {
        const references = [ref(), ref({source_list_wikilink: "https://en.wikipedia.org/wiki/2004_in_music", album_name: "Missing"})];
        expect(await query([release()], references, "full")).toHaveLength(1);
        expect(await query([release({wikilink: "https://en.wikipedia.org/wiki/It%27s_Wild"})], [ref({album_wikilink: "https://en.wikipedia.org/wiki/It's_Wild"})], "full")).toHaveLength(1);
    });

    it("does not let null reference IDs or null release URLs hide unrelated albums", async () => {
        expect(await query([release(), release({wikilink: null, wikipedia_page_id: null})], [ref({wikipedia_page_id: null})], "full")).toHaveLength(2);
    });

    it("handles thousands of unmatched releases and references without pairwise comparisons", async () => {
        const releases = Array.from({length: 3000}, (_, index) => release({
            wikipedia_page_id: index + 10000, title: `Missing ${index}`, original_title: `Missing ${index}`,
            wikilink: `https://en.wikipedia.org/wiki/Missing_${index}`,
        }));
        const references = Array.from({length: 3000}, (_, index) => ref({
            wikipedia_page_id: index + 20000, album_name: `Listed ${index}`,
            album_wikilink: `https://en.wikipedia.org/wiki/Listed_${index}`,
        }));
        expect(await query(releases, references, "full")).toHaveLength(3000);
    }, 10000);

    it("preserves date completeness, exclusions, review overrides, and ordering", async () => {
        const releases = [release({title: "Later", original_title: "Later", number_of_reviews: 9}),
            release({title: "Earlier", original_title: "Earlier", manual_number_of_reviews: 1}),
            release({title: "Undated", original_title: "Undated", dateday: null}),
            release({dateyear: 2004}), release({releasetype: "compilation"}),
            release({original_categories_text: "2003 reissue albums"})];
        expect((await query(releases, [], "full")).map(row => [row.title, row.effective_number_of_reviews])).toEqual([["Earlier", 1], ["Later", 9]]);
        expect((await query(releases, [])).map(row => row.title)).toEqual(["Earlier", "Undated", "Later"]);
    });
});
