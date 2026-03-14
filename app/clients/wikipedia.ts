import * as cheerio from "cheerio";

const WIKIPEDIA_USER_AGENT =
    "MoosicGraffBot/2.0 (https://github.com/dallincoons/moosicgraff; contact: dallincoons@gmail.com)";

export async function getHtml(url: string): Promise<string> {
    const $ = await loadWikipediaPage(url);
    return $.html();
}

export async function getHtmlAndWikiLinks(url: string): Promise<{ html: string; wikiLinks: string[] }> {
    const $ = await loadWikipediaPage(url);
    const wikiLinks: string[] = [];

    $('a[href^="/wiki/"]').each((_, element) => {
        const href = $(element).attr("href");
        if (!href) {
            return;
        }

        wikiLinks.push(`https://en.wikipedia.org${href}`);
    });

    return {
        html: $.html(),
        wikiLinks,
    };
}
export async function getPageText(url: string): Promise<string> {
    const $ = await loadWikipediaPage(url);
    return $.text();
}

export async function getWikiLinks(url: string): Promise<string[]> {
    const $ = await loadWikipediaPage(url);
    const links: string[] = [];

    $('a[href^="/wiki/"]').each((_, element) => {
        const href = $(element).attr("href");
        if (!href) {
            return;
        }

        links.push(`https://en.wikipedia.org${href}`);
    });

    return links;
}

export async function getSectionText(url: string, startHeader: string, endHeader: string): Promise<string> {
    const $ = await loadWikipediaPage(url);
    const base = `h2:contains('${startHeader}')`;
    const end = `h2:contains('${endHeader}')`;
    return $(base).parent().nextUntil(end).text();
}

async function loadWikipediaPage(url: string) {
    return cheerio.fromURL(url, {
        requestOptions: {
            headers: {
                "User-Agent": WIKIPEDIA_USER_AGENT,
            },
            method: "GET",
        },
    });
}
