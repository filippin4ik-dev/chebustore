import { Bot } from "grammy";
import { config } from "../config.js";

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
