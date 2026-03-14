import openai from "app/clients/openai";
import {getHtml} from "app/clients/wikipedia";

export async function getArtistLinksFromContent(content: string): Promise<string> {
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

        const isBandPage = /Template:Infobox_musical_artist|Template:Infobox_band/i.test(html);
        if (!isBandPage) return '';

        const match = html.match(/<title>(.*?) - Wikipedia<\/title>/);
        if (!match) return '';

        let bandName = match[1];

        return bandName.replace(/\s*\(.*?\)\s*$/, '');
    } catch (e) {
        console.log("failed to get band name. " + e);
        return '';
    }
}
