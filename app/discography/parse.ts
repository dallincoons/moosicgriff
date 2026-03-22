import {Artist} from "../artists/artist";
import {Release} from "app/discography/release";

export function parseReleases(rawContents: string): Release[] {
    let pattern = `Release name:[ ]*(.+).*\n.+Producer:[ ]{0,1}(.+).*\n.+Type of release:[ ]*(.+)\n.+Label(?:s)*: (.+)\n.+Year released:[ ]*(.+)\n.+Month released:[ ]*(.+)\n.+Day released:[ ]*(.+)\n(?:.+(https.+)\\))?`

    const regex = new RegExp(pattern, "gi")
    let matches = [...rawContents.matchAll(regex)];

    if (!matches) {
        return [];
    }

    return matches.map(function(match) {
        return{
                artist_wikilink: "",
                artist_name: "",
                artist_display_name: "",
                name: <string>match[1],
                original_title: <string>match[1],
                producer: <string>match[2],
                studio: "",
                type: <string>match[3],
                label: <string>match[4],
                genre: "",
                original_genre: "",
                recorded: "",
                year: isNaN(parseInt(match[5])) ? null : parseInt(match[5]),
                month: !!match[6] ? match[6].trim() : "",
                day: isNaN(parseInt(match[7])) ? null : parseInt(match[7]),
                wikilink: <string>match[8] ?? "",
                wikipedia_page_id: null,
                number_of_reviews: 0,
                review_links: "",
            }
    });
}
