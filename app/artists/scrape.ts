import {getHtmlAndWikiLinks, resolveWikipediaPageInfo} from "app/clients/wikipedia";
import {parseArtists} from "./parse";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import {Artist, DBArtist} from 'app/artists/artist';
import artists from 'app/repositories/artists/artists'
import deadlinks from 'app/repositories/deadlinks/deadlinks'
import {getArtistLinksFromContent, getBandName} from "./chat";
import {recordDeadlinkAdded, recordNewArtist} from "./runsummary";
import {createHash} from "crypto";
import {isStopRequested} from "app/runtime/stop";

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(({ level, message, timestamp }) => {
            return `\n[${timestamp}] ${level.toUpperCase()}: ${message}\n`;
        }),
    ),
    transports: [new DailyRotateFile({
        filename: 'logs/%DATE%.log',
        datePattern: 'YYYY-MM-DD-HH',
    }),
    new winston.transports.Console()]
})

const green = "\x1b[32m";
const reset = "\x1b[0m";

export function closeArtistScrapeResources(): void {
    logger.close();
}

export async function handleLink(link: string, parentLink: string = ""): Promise<void> {
    if (await artists.getArtistByUrl(link)) {
        return;
    }

    if (await deadlinks.doesDeadLinkExist(link)) {
        return;
    }

    let bandName = await getBandName(link);
    if (!bandName || bandName == `""`) {
        console.log("inserting dead link: " + link);
        if (isStopRequested()) {
            return;
        }
        await deadlinks.insertNew(link);
        recordDeadlinkAdded();
        return;
    }

    const pageInfo = await resolveWikipediaPageInfo(link);
    const resolvedLink = pageInfo.resolvedUrl;
    const pageId = pageInfo.pageId;

    if (pageInfo.isRedirect && pageInfo.originalUrl !== resolvedLink) {
        console.log(`redirect detected: ${pageInfo.originalUrl} -> ${resolvedLink}`);
    }

    if (pageInfo.isDisambiguation) {
        console.log(`skipping disambiguation page: ${resolvedLink}`);
        return;
    }

    if (resolvedLink !== link) {
        if (await deadlinks.doesDeadLinkExist(resolvedLink)) {
            return;
        }
        if (await artists.getArtistByUrl(resolvedLink)) {
            return;
        }

        const resolvedBandName = await getBandName(resolvedLink);
        if (resolvedBandName && resolvedBandName !== `""`) {
            bandName = resolvedBandName;
        }
    }

    if (pageId) {
        const existingByPageId = await artists.getArtistByWikipediaPageId(pageId);
        if (existingByPageId) {
            return;
        }
    }

    try {
        console.log(`${green}inserting new artist: ${bandName}${reset}`);
        if (isStopRequested()) {
            return;
        }
        await artists.insertNew(bandName, resolvedLink, parentLink, pageId);
        recordNewArtist(bandName, resolvedLink);
        console.log(`${green}saved new artist: ${resolvedLink}${reset}`);
    } catch (e) {
        // console.log("error persisting child: " + e);
    }
}

export async function scrape(runStartedAt: Date = new Date(), hasProcessedArtists: boolean = false) {
    const nextArtist = await artists.nextInQueue(runStartedAt);

    if (!nextArtist) {
        console.log(hasProcessedArtists ? "No more artists to process." : "No artists to process.");
        return;
    }

    const artist = translateDBArtist(nextArtist);

    const persistedArtist = await artists.getArtistByUrl(artist.url);

    const pageData = await getChildren(artist);
    const pageContentHash = hashContent(pageData.html);

    if (persistedArtist?.page_content_hash && persistedArtist.page_content_hash === pageContentHash) {
        if (isStopRequested()) {
            return;
        }
        console.log(`No page changes detected for ${artist.url}; skipping.`);
        await artists.markAsPeersFound(artist.url);
        await scrape(runStartedAt, true);
        return;
    }

    const links: string[] = pageData.links;

    for (const link of links) {
        if (isStopRequested()) {
            break;
        }
        await handleLink(link, artist.url);
    }

    if (isStopRequested()) {
        return;
    }
    await artists.updatePageContentHash(artist.url, pageContentHash);
    await artists.markAsPeersFound(artist.url);

    await scrape(runStartedAt, true);
}

async function getChildren(artist:Artist): Promise<{html: string; links: string[]}> {
    // let response;
    try {
        return await getArtistPageDataFromUrl(artist.url);
    } catch (e: any) {
        if (e.status == 404) {
            console.log("deleting: " + artist.url);
            if (isStopRequested()) {
                return { html: "", links: [] };
            }
            await artists.delete(artist.url);
            return { html: "", links: [] };
        }
        console.log("error" + e);
        throw e;
    }
}

export async function getArtistPeersFromUrl(artistUrl: string) {
    const pageData = await getArtistPageDataFromUrl(artistUrl);
    return pageData.links;
}

async function getArtistPageDataFromUrl(artistUrl: string): Promise<{html: string; links: string[]}> {
    logger.info("fetching: " + artistUrl);

    let pageData = await getHtmlAndWikiLinks(artistUrl);
    let rawLinks = pageData.wikiLinks;

    let links: string[] = [];

    rawLinks.forEach((link) => {
        const href = link.replace("https://en.wikipedia.org", "");

        if (!href) {
            return;
        }

        // Skip special pages like /wiki/Help: or /wiki/File:
        if (
            !href.includes(':') &&    // exclude /wiki/File:, /wiki/Category:, etc.
            !href.includes('#')  &&   // exclude in-page anchors
            !href.includes('album)') &&  // exclude obvious albums
            !href.includes('EP)') &&  // exclude obvious EPs
            !href.includes('_EP') &&  // exclude obvious EPs
            !href.includes('song)') &&  // exclude obvious songs
            !href.includes('politician)') &&  // exclude obvious people
            !href.includes('filmmaker)') &&  // exclude obvious people
            !href.includes('discography)') &&  // exclude discography pages
            !href.includes('_discography') &&  // exclude discography pages
            !href.includes('book)') &&  // exclude books
            !href.includes('film)') &&  // exclude films
            !href.includes('series)') &&  // exclude TV series
            !href.includes('(TV_Series)') &&  // exclude TV series
            !href.includes('novel)') &&  // exclude novels
            !href.includes('anime)') &&  // exclude anime
            !href.includes('manga)') &&  // exclude novels
            !href.includes('surname)') &&  // exclude names
            !href.includes('game_designer)') &&  // exclude game designers
            !href.includes('comics)')  && // exclude game designers
            !href.includes('comic_artist)')  &&
            !href.includes('_episodes') && // exclude episodes
            !href.includes('(disambiguation)') && // exclude disambiguation pages
            !href.includes('single)') && // exclude singles
            !href.includes('soundtrack)') && // exclude soundtracks
            !href.includes('box_set)') && // exclude box sets
            !href.includes('biblical_figure)') && // exclude biblical figures
            !href.includes('comedian)') && // exclude comedians
            !href.includes('(Comedian)') && // exclude comedians
            !href.includes('military)') && // exclude military
            !href.includes('musical)') && // exclude musicals
            !href.includes('waltz)') && // exclude waltzes
            !href.includes('historical_figure)') && // exclude historical figures
            !href.includes('computing_and_electronics)') && // exclude computing and electronics
            !href.includes('List_of_') && // exclude lists
            !href.includes('(magazine)') && // exclude magazines
            !href.includes('(fashion_designer)') && // exclude fashion designers
            !href.includes('(company)') && // exclude companies
            !href.includes('_(season_') && // exclude TV seasons
            !href.includes('_(American_season') && // exclude TV seasons
            !href.includes('(gamer)') && // exclude gamers
            !href.includes('(TV_personality)') && // exclude TV personalities
            !href.includes('(YouTuber)') && // exclude YouTube personalities
            !href.includes('(soldier)') && // exclude soldiers
            !href.includes('(television_personality)') && // exclude television personalities
            !href.includes('(music_executive)') && // exclude music executives
            !href.includes('(streamer_collective)') && // exclude music executives
            !href.includes('(web_channel)') && // exclude web channels
            !href.includes('_season_1') && // exclude seasons
            !href.includes('_season_2') && // exclude seasons
            !href.includes('(vehicle)') && // exclude vehicles
            !href.includes('(name)') && // exclude names
            !href.includes('(franchise)') && // exclude franchises
            !href.includes('(video_game)') && // exclude video games
            !href.includes('(video_games)') && // exclude video games
            !href.includes('_video_game)') && // exclude video games
            !href.includes('(actor)') && // exclude actors
            !href.includes('(informants)') && // exclude informants
            !href.includes('(states)') && // exclude states
            !href.includes('(studio)') // exclude studios
            && !href.includes('(arcade_game)') // exclude arcade games
            && !href.includes('(play)') // exclude plays
            && !href.includes('(character)') // exclude characters
            && !href.includes('(producer)') // exclude producers
            && !href.includes('(compilation)') // exclude compilations
            && !href.includes('(radio_program)') // exclude radio programs
            && !href.includes('(radio_show)') // exclude radio shows
            && !href.includes('(radio_series)') // exclude radio series
            && !href.includes('(radio_station)') // exclude radio stations
            && !href.includes('(radio_network)') // exclude radio networks
            && !href.includes('(radio_format)') // exclude radio formats
            && !href.includes('(radio_genre)') // exclude radio genres
            && !href.includes('(video_game_company)') // exclude video game companies
            && !href.includes('(video_game_publisher)') // exclude video game publishers
            && !href.includes('(video_game_developer)') // exclude video game developers
            && !href.includes('(journal)') // exclude journals
            && !href.includes('(mixtape)') // exclude mixtapes
            && !href.includes('(director)') // exclude directors
            && !href.includes('(television_director)') // exclude television directors
            && !href.includes('(radio_director)') // exclude radio directors
            && !href.includes('(music_director)') // exclude music directors
            && !href.includes('(record_label)') // exclude record labels
            && !href.includes('(radio_program)') // exclude radio programs
            && !href.includes('(radio_show)') // exclude radio shows
            && !href.includes('(radio_series)') // exclude radio series
            && !href.includes('(dance)') // exclude dances
            && !href.includes('(fashion_house)') // exclude fashion houses
            && !href.includes('(fashion_designer)') // exclude fashion designers
            && !href.includes('(fashion)') // exclude fashion
            && !href.includes('(clothing_retailer)') // exclude clothing retailers
            && !href.includes('(solo_artist)') // exclude solo artists
            && !href.includes('(broadcaster)') // exclude broadcasters
            && !href.includes('(radio_host)') // exclude radio hosts
            && !href.includes('(radio_presenter)') // exclude radio presenters
            && !href.includes('(actress)') // exclude actresses
            && !href.includes('(American_actress)') // exclude actresses
            && !href.includes('(British_actress)') // exclude actresses
            && !href.includes('(actor)') // exclude actors
            && !href.includes('(American_actor)') // exclude actors
            && !href.includes('(British_actor)') // exclude actors
            && !href.includes('(producer)') // exclude producers
            && !href.includes('(music)') // exclude music
            && !href.includes('(newspaper)') // exclude newspapers
            && !href.includes('(magazine)') // exclude magazines
            && !href.includes('(South_Korea)') // exclude South Korea
            && !href.includes('(entrepreneur)') // exclude entrepreneur
            && !href.includes('(punctuation)') // exclude punctuation
            && !href.includes('(writer)') // exclude writers
            && !href.includes('(bishop)') // exclude bishops
            && !href.includes('(Musical)') // exclude musicals
            && !href.includes('(screenwriter)') // exclude screenwriters
            && !href.includes('(British_businessman)') // exclude businessmen
            && !href.includes('(businessman)') // exclude businessmen
            && !href.includes('(painter)') // exclude painters
            && !href.includes('(city)') // exclude cities
            && !href.includes('_album)') // exclude albums
            && !href.includes('TV_network)') // exclude TV networks
            && !href.includes('association)') // exclude associations
            && !href.includes('publication)') // exclude publications
            && !href.includes('hazard)') // exclude hazards
            && !href.includes('medical)') // exclude medicals
            && !href.includes('diver)') // exclude divers
            && !href.includes('diving)') // exclude diving
            && !href.includes('(film_director)') // exclude film directors
            && !href.includes('(sound_editor)') // exclude sound editors
            && !href.includes('(sound_engineer)')
            && !href.includes('_sound_engineer)')
            && !href.includes('(sound_editor)')
            && !href.includes('(audio_engineer)')
            && !href.includes('(sound_designer)')
            && !href.includes('(radio_personality)')
            && !href.includes('(Harry_Potter)')
            && !href.includes('(racing_driver)')
            && !href.includes('(motorsport_commentator)')
            && !href.includes('(motorsport_executive)')
            && !href.includes('(NHL)')
            && !href.includes('(photographer)')
            && !href.includes('(mythology)')
            && !href.includes('(chef)')
            && !href.includes('(sportscaster)')
            && !href.includes('(American_football)')
            && !href.includes('(American_football_coach)')
            && !href.includes('(defensive_tackle)')
            && !href.includes('(wide_receiver)')
            && !href.includes('(defensive_lineman)')
            && !href.includes('(journalist)')
            && !href.includes('(golfer)')
            && !href.includes('(footballer)')
            && !href.includes('(ice_hockey)')
            && !href.includes('(Royal_Navy_officer)')
            && !href.includes('(British_Army_officer)')
            && !href.includes('(sea_captain)')
            && !href.includes('(general)')
            && !href.includes('(minister)')
            && !href.includes('(dancer)')
        ) {
            links.push('https://en.wikipedia.org' + href);
        }
    });

    return { html: pageData.html, links };
}

function hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

function translateDBArtist(artist:DBArtist): Artist {
    return {
        name: artist.artistname,
        url: artist.wikilink,
        graph: {
            parentUrl: artist.parent_wikilink,
        }
    }
}
