import {db} from 'app/repositories/db';
import {Release} from "../../discography/release";
import {DBArtist} from "../../artists/artist.d.ts";

class Discography {
    async insertRelease(release: Release, artist: DBArtist) {
        console.log({release});
        await db`
            insert into releases
                (
                    wikilink,
                    artist_wikilink,
                    artist_name,
                    title,
                    releasetype,
                    label,
                    producer,
                    dateday,
                    datemonth,
                    dateyear
                ) VALUES (
                    ${release.wikilink}::text,
                    ${artist.wikilink}::text,
                    ${artist.artistname}::text,
                    ${release.name}::text,
                    ${release.type}::text,
                    ${release.label}::text,
                    ${release.producer}::text,
                    ${release.day}::integer,
                    ${release.month}::text,
                    ${release.year}::integer
                )
        `
    }
}

export default new Discography();
