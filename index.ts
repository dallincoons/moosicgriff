import { scrape } from './artists/scrape'
import postgres from "postgres";
import {DB_STRING} from "./config";

// const db = postgres(DB_STRING);
//
// const
//     name = "Nirvana",
//     url = 'https://en.wikipedia.org/wiki/Nirvana_(band)',
//     parentUrl = ""
//
//
// await db`
//         insert into artists
//         (artistname, wikilink, parent_wikilink) VALUES
//         (${ name }::text, ${ url }::text, ${ parentUrl }::text)
//         `

scrape();
