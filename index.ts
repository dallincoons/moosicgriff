import { scrape as artistScrape, handleLink } from './app/artists/scrape';
import { scrape as labelScrape } from './app/labels/scrape';
import { scrape as discographyScrape } from './app/discography/scrape';
import { artistQuery } from './app/artists/query/artist';
import { discographyQuery } from './app/discography/query/fromartistpage';
import {getArtistLinksFromContent} from "./app/artists/chat";
import {bandCheck} from "./app/artists/query/bandcheck";

const args = process.argv.slice(2);

if (args.length > 2) {
    console.log("you can't give more than two arguments, dumb shit");
}

switch (args[0]) {
    case 'artists':
        artistScrape();
        break;
    case 'artist.query':
        artistQuery(args[1]);
        break;
    case 'link.scrape':
        bandCheck(args[1]);
        break;
    case 'discography':
        discographyScrape();
        break;
    case 'discography.query':
        discographyQuery(args[1]);
        break;
    case 'labels':
        labelScrape();
        break;
    default:
        "command not recognized";
}

