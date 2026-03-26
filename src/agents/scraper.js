/**
 * @file src/agents/scraper.js
 * @description Scraper Engine (Agent 2) - Calls the Anthropic API with web_search to find competitor social links.
 */

import { API_MODEL, API_MAX_TOKENS, SCRAPE_DELAY_MS, API_ENDPOINT, VALID_PLATFORMS } from '../constants.js';

/**
 * @typedef {Object} Competitor
 * @property {string} name - Brand name
 * @property {string} url - Website URL
 */

/**
 * @typedef {Object} Result
 * @property {string} name - Brand name
 * @property {string} url - Website URL
 * @property {Object.<string, string>} socials - Map of PlatformName -> URL
 * @property {'ok' | 'no_links' | 'unreachable' | 'error' | 'parse_error'} status - Status string
 */

/**
 * Delays execution for a given number of milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Normalizes a URL to ensure it starts with http:// or https://
 * @param {string} url - The URL to normalize
 * @returns {string} - The normalized URL
 */
const normalizeUrl = (url) => {
  if (!url) return '';
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    return `https://${url}`;
  }
  return url;
};

/**
 * Processes a single competitor, calls the Anthropic API to find social links, and handles errors.
 * 
 * @param {Competitor} competitor - The competitor to scrape
 * @param {number} index - For logging: 1-based index of this competitor
 * @param {number} total - For logging: Total number of competitors
 * @param {function(string): void} [addLog] - Optional callback for appending log messages
 * @returns {Promise<Result>} - Structured processing result
 */
export async function scrapeCompetitor(competitor, index = 1, total = 1, addLog = () => {}) {
  const baseResult = {
    name: competitor.name || 'Unknown',
    url: competitor.url || '',
    socials: {},
    status: 'idle'
  };

  try {
    const normUrl = normalizeUrl(competitor.url);
    baseResult.url = normUrl || competitor.url;
    
    let brandName = competitor.name;
    if (!brandName) {
      try {
        brandName = new URL(normUrl).hostname.replace(/^www\./, '');
      } catch (e) {
        brandName = 'Unknown Brand';
      }
    }
    
    addLog(`[${index}/${total}] Scraping ${brandName} at ${baseResult.url}...`);

    if (!normUrl) {
      baseResult.status = 'error';
      addLog(`  -> Invalid: URL is empty.`);
      return baseResult;
    }

    // 1. Try Direct Local Scraping First
    try {
      addLog(`  -> Attempting direct scrape via local backend...`);
      const scrapeResponse = await fetch(`/api/scrape?url=${encodeURIComponent(normUrl)}`);
      if (scrapeResponse.ok) {
        const directSocials = await scrapeResponse.json();
        if (Object.keys(directSocials).length > 0) {
          baseResult.socials = directSocials;
          baseResult.status = 'ok';
          addLog(`  -> Success (Direct). Found: ${Object.keys(directSocials).join(', ')}`);
          return baseResult;
        }
        addLog(`  -> Direct scrape found no social links on page. Falling back to AI search...`);
      } else {
        addLog(`  -> Direct scrape failed (HTTP ${scrapeResponse.status}). Falling back to AI search...`);
      }
    } catch (err) {
      addLog(`  -> Direct scrape unavailable: ${err.message}. Falling back to AI search...`);
    }

    // 2. Fallback to AI Search if direct scrape failed
    const prompt = `You are a web researcher.
Search the web for the brand "${brandName}" and their website ${baseResult.url}.
Find their official social media profiles on:
${VALID_PLATFORMS.join(', ')}
Return ONLY a valid JSON object. No explanation. No markdown fences.
Example: {"Facebook": "https://facebook.com/brand", "Instagram": "https://instagram.com/brand"}
If unreachable: {"error": "unreachable"}
If no social links found: {}`;

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: API_MODEL,
          max_tokens: API_MAX_TOKENS,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) {
        if (response.status === 404) {
          addLog(`  -> AI search proxy not configured. Done.`);
          baseResult.status = 'no_links';
          return baseResult;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Extract text blocks
      if (!data.content || !Array.isArray(data.content)) {
         throw new Error(`Unexpected API response structure`);
      }

      const textContent = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      let cleanJsonText = textContent;
      const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanJsonText = jsonMatch[0];
      } else {
        cleanJsonText = cleanJsonText
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
      }
      
      let parsedResult;
      try {
        parsedResult = JSON.parse(cleanJsonText);
      } catch (e) {
        baseResult.status = 'parse_error';
        addLog(`  -> Parse Error: Invalid JSON response.`);
        return baseResult;
      }

      if (!parsedResult || typeof parsedResult !== 'object' || Array.isArray(parsedResult)) {
        baseResult.status = 'parse_error';
        addLog(`  -> Parse Error: Response is not a root JSON object.`);
        return baseResult;
      }

      if (parsedResult.error) {
        baseResult.status = 'unreachable';
        addLog(`  -> Unreachable as reported by search tool.`);
        return baseResult;
      }

      const validSocials = {};
      for (const [key, val] of Object.entries(parsedResult)) {
        if (typeof val === 'string' && /^https?:\/\//i.test(val)) {
          validSocials[key] = val;
        }
      }
      
      baseResult.socials = validSocials;

      if (Object.keys(validSocials).length === 0) {
        baseResult.status = 'no_links';
        addLog(`  -> Done. No links found.`);
      } else {
        baseResult.status = 'ok';
        addLog(`  -> Success (AI). Found: ${Object.keys(validSocials).join(', ')}`);
      }

      return baseResult;

    } catch (innerError) {
      baseResult.status = 'error';
      addLog(`  -> AI Search Network Error: ${innerError.message}`);
      return baseResult;
    }

  } catch (error) {
    baseResult.status = 'error';
    addLog(`  -> Critical Scraper Error: ${error.message}`);
    return baseResult;
  }
}

/**
 * Runner function to sequentially scrape a list of competitors
 * 
 * @param {Competitor[]} competitors - List of competitors to process
 * @param {function(Result): void} [addResult] - Callback triggered for each completed result
 * @param {function(string): void} [addLog] - Callback for log messages
 * @param {AbortSignal} [signal] - Optional standard abort signal to immediately stop processing
 */
export async function scrapeAll(competitors, addResult = () => {}, addLog = () => {}, signal = null) {
  let completedCount = 0;
  for (let i = 0; i < competitors.length; i++) {
    if (signal?.aborted) {
      addLog('Scraping aborted by user.');
      break;
    }
    
    const result = await scrapeCompetitor(competitors[i], i + 1, competitors.length, addLog);
    addResult(result);
    completedCount++;

    if (i < competitors.length - 1 && !signal?.aborted) {
      await delay(SCRAPE_DELAY_MS);
    }
  }
  return completedCount;
}
