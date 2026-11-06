import discography from "app/repositories/discography/discography";
import {db} from "app/repositories/db";
import {Release} from "app/discography/release";

jest.mock("app/repositories/db", () => ({db: jest.fn()}));

describe("discography artist reassignment", () => {
    it("updates the artist URL together with its id and names on an existing release", async () => {
        (db as unknown as jest.Mock).mockResolvedValue([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{
            id: 126861,
            artist_wikilink: "https://en.wikipedia.org/wiki/Omni_(Minus_the_Bear_album)",
        }]);
        const release: Release = {
            artist_name: "Omni", artist_display_name: "Omni",
            artist_wikilink: "https://en.wikipedia.org/wiki/Omni_(band)",
            name: "Networker", original_title: "Networker (album)",
            wikilink: "https://en.wikipedia.org/wiki/Networker_(album)",
            type: "studio", year: 2019, month: "November", day: 1,
            producer: "Omni", studio: "", label: "Sub Pop", original_labels_text: "[[Sub Pop]]",
            original_categories_text: "", genre: "Post-punk", original_genre: "[[Post-punk]]",
            recorded: "", number_of_reviews: 5, review_links: "",
        };

        await discography.upsertRelease(release, {
            id: 221280, artistname: "Omni", wikilink: release.artist_wikilink,
            found_peers: false, parent_wikilink: "",
        }, "content-hash");

        const updates = (db as unknown as jest.Mock).mock.calls.filter(([parts]) => parts.join("").includes("update releases"));
        expect(updates).toHaveLength(1);
        const [parts, ...values] = updates[0];
        const assignments = new Map(parts.slice(0, -1).map((part: string, index: number) => [
            part.match(/(\w+)\s*=\s*$/)?.[1], values[index],
        ]));
        expect(assignments.get("artist_id")).toBe(221280);
        expect(assignments.get("artist_wikilink")).toBe(release.artist_wikilink);
        expect(assignments.get("artist_name")).toBe("Omni");
        expect(assignments.get("artist_display_name")).toBe("Omni");
    });
});
