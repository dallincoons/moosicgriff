import env from 'dotenv';

env.config();

export const
    OPEN_API_API_KEY = process.env.OPEN_API_API_KEY,
    MAX_DEPTH = process.env.MAX_DEPTH;
