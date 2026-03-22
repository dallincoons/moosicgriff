import {getHtml} from "app/clients/wikipedia";

export async function getArtistLinksFromContent(content: string): Promise<string> {
    const { default: openai } = await import("app/clients/openai");
    const response = await openai.chat.completions.create({
        messages: [
            {
                role: "user",
                content: `give me wikipedia page links to the solo artists and bands listed in this article who have a discography (but don't include the discography page) \n Respond in this format: **band name**: [band name](link to wikipedia page) \n ${content}`,
            },
        ],
        model: "gpt-4o",
    });

    if (!response || !response.choices || !response.choices[0]!.message) {
        return "";
    }

    return response.choices[0].message.content!.toString();
}

export async function getBandName(link: string): Promise<string> {
    try {
        let html = await getHtml(link);
        const urlIndicatesBand = /\(band\)/i.test(decodeURIComponent(link));

        const isBandPage = /Template:Infobox_musical_artist|Template:Infobox_band/i.test(html);
        if (!isBandPage && !urlIndicatesBand) return '';

        const match = html.match(/<title>(.*?) - Wikipedia<\/title>/);
        if (match && match[1]) {
            let bandName = match[1];
            const normalized = bandName.replace(/\s*\(.*?\)\s*$/, '');
            return normalized;
        }

        if (urlIndicatesBand) {
            return getNameFromUrl(link);
        }

        return '';
    } catch (e) {
        console.log("failed to get band name. " + e);
        if (/\(band\)/i.test(decodeURIComponent(link))) {
            return getNameFromUrl(link);
        }
        return '';
    }
}

function getNameFromUrl(link: string): string {
    try {
        const pathname = new URL(link).pathname;
        const page = decodeURIComponent(pathname.replace(/^\/wiki\//, ""));
        return page
            .replace(/_/g, " ")
            .replace(/\s*\(.*?\)\s*$/, "")
            .trim();
    } catch (e) {
        return "";
    }
}
