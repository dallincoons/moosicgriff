import {__private} from "app/clients/wikipediaapi";

describe("wikipediaapi parseReleaseDate", () => {
    it("uses the first date when multiple dates are present on separate lines", () => {
        const result = __private.parseReleaseDate("January 1, 2005\nJanuary 1, 2025");
        expect(result).toEqual({
            year: 2005,
            month: "January",
            day: 1,
        });
    });

    it("uses the first start date template when multiple are present", () => {
        const result = __private.parseReleaseDate(
            "{{start date|2005|1|1|df=yes}}<br>{{start date|2025|1|1|df=yes}}",
        );
        expect(result).toEqual({
            year: 2005,
            month: "January",
            day: 1,
        });
    });

    it("uses the first bullet in plainlist release dates", () => {
        const result = __private.parseReleaseDate(
            "{{plainlist|\n* January 1, 2005\n* January 1, 2025\n}}",
        );
        expect(result).toEqual({
            year: 2005,
            month: "January",
            day: 1,
        });
    });

    it("uses the first line even when later lines are different month/year", () => {
        const result = __private.parseReleaseDate("September 26, 2005 (US)\nMarch 1, 2025 (reissue)");
        expect(result).toEqual({
            year: 2005,
            month: "September",
            day: 26,
        });
    });
});

describe("wikipediaapi normalizeWikiTitle", () => {
    it("does not throw on malformed percent-encoded titles", () => {
        expect(() => __private.normalizeWikiTitle("3%_(group)")).not.toThrow();
        expect(__private.normalizeWikiTitle("3%_(group)")).toBe("3% (group)");
    });

    it("decodes valid percent-encoded titles", () => {
        expect(__private.normalizeWikiTitle("Fran%C3%A7ois_Cheng")).toBe("François Cheng");
    });
});
