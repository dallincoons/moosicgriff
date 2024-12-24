import { scrape as artistScrape } from './app/artists/scrape';
import { scrape as labelScrape } from './app/labels/scrape';

const args = process.argv.slice(2);

if (args.length > 1) {
    console.log("you can't give more than one argument, dumb shit");
}

switch (args[0]) {
    case 'artists':
        artistScrape();
        break;
    case 'labels':
        labelScrape();
        break;
}

