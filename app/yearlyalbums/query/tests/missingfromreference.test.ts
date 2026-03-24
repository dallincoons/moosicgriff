import {parseDateCompletenessMode} from "app/yearlyalbums/query/missingmode";

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
