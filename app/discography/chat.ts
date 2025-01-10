import {OPEN_API_API_KEY} from "../../config";
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: OPEN_API_API_KEY
});

export async function getDiscographyFromArtists(content: string): Promise<string> {
    const response = await openai.chat.completions.create({
        messages: [
            {
                role: "user",
                content: `list all the music releases for this artist, with the wikipedia links if available \n Respond in this format: release name: producer: type of release: label: year released: link to wikipedia page \n ${content}`,
            },
        ],
        model: "gpt-4o",
    });

    if (!response || !response.choices || !response.choices[0]!.message) {
        return "";
    }

    return response.choices[0].message.content!.toString();
}
