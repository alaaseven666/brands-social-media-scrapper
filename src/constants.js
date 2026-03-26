/**
 * @file src/constants.js
 * @description Shared constants and configuration for the Competitor Social Link Scraper
 */

export const API_MODEL = "claude-sonnet-4-20250514";
export const API_MAX_TOKENS = 1000;
export const SCRAPE_DELAY_MS = 600; // Delay between API calls to avoid rate limiting
export const API_ENDPOINT = "/v1/messages"; // Base path for Claude artifact proxy

/**
 * List of standard recognized platforms as specified in the PRD.
 * @type {string[]}
 */
export const VALID_PLATFORMS = [
  "Facebook",
  "Twitter",
  "Instagram",
  "LinkedIn",
  "TikTok",
  "YouTube",
  "Pinterest",
  "Snapchat",
  "Threads"
];
