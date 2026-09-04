-- OpenAI Ads (ChatGPT Ads) as a spend-reporting platform, so ChatGPT spend
-- flows into the same platform-sync reports as every other ad platform.

-- AlterEnum
ALTER TYPE "AdPlatform" ADD VALUE 'openai';
