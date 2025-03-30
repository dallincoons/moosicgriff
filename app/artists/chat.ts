import {OPEN_API_API_KEY} from "../../config";
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: OPEN_API_API_KEY
});

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
