import {Artist} from "../artists/artist";
import {Release} from "app/discography/release";

export function parseReleases(rawContents: string): Release[] {
    console.log({rawContents});
    let pattern = `Release name:[ ]*(.+).*\n.+Producer:[ ]{0,1}(.+).*\n.+Type of release:[ ]*(.+)\n.+Label(?:s)*: (.+)\n.+Year released:[ ]*(.+)\n.+Month released:[ ]*(.+)\n.+Day released:[ ]*(.+)\n(?:.+(https.+)\\))?`

    const regex = new RegExp(pattern, "gi")
    let matches = [...rawContents.matchAll(regex)];

    if (!matches) {
        return [];
    }

    return matches.map(function(match) {
        return{
                artist_wikilink: "",
                name: <string>match[1],
                producer: <string>match[2],
                type: <string>match[3],
                label: <string>match[4],
                year: isNaN(parseInt(match[5])) ? null : parseInt(match[5]),
                month: !!match[6] ? match[6].trim() : "",
                day: isNaN(parseInt(match[7])) ? null : parseInt(match[7]),
                wikilink: <string>match[8] ?? "",
            }
    });
}
