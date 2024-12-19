import env from 'dotenv';

env.config();

export const
    OPEN_API_API_KEY = process.env.OPEN_API_API_KEY,
    MAX_DEPTH = parseInt(<string>process.env.MAX_DEPTH, 10) || 0,
    DB_STRING = <string>process.env.GOOSE_DBSTRING;
