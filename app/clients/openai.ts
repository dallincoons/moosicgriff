import OpenAI from "openai";
import { OPEN_API_API_KEY } from "../../config";

const openai = new OpenAI({
    apiKey: OPEN_API_API_KEY,
});

export default openai;
